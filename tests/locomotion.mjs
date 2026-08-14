// Locomotion regression test.
//
// Drives Peggy.update() DIRECTLY at a fixed timestep inside the page, rather
// than pressing keys and waiting. That matters: under software rendering the
// loop's step budget runs out and the game goes into slow motion, so anything
// measured off wall-clock time is measuring the renderer, not the controller.
// Stepping the controller by hand makes the numbers exact and reproducible.
//
//   npm test          (starts a server on 8123 first — see package.json)
//
// Every assertion here corresponds to a bug this file has already caught:
//
//   step-up          crates were unclimbable, then juddered at the seam
//   dive depth       DIVE flipped straight back to SWIM every single frame
//   steep slope      the "unwalkable" spire was quietly walkable
//   hook             the head flew along the camera aim and missed the anchor
//   fell through     -
//
// If you change TUNING in Peggy.js, EXPECT these numbers to move. Update the
// expectations deliberately; don't loosen them until they pass.
import { chromium } from 'playwright';

const URL = process.argv[2] || 'http://localhost:8123/index.html';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
const errors = [];
const missing = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('response', (r) => { if (r.status() === 404) missing.push(r.url()); });

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.peggy && window.loop && window.loop.running, null, { timeout: 20000 });
await page.waitForTimeout(500);

const out = await page.evaluate(() => {
  const DT = 1 / 120;
  const P = window.peggy, F = window.follow, L = window.level, H = window.hook;

  // A stand-in for the Input object: same shape, fully scriptable.
  const mkBtn = () => ({ down: false, pressed: false, released: false });
  const btns = { jump: mkBtn(), dive: mkBtn(), hook: mkBtn(), melee: mkBtn(), meleeAngle: null };
  const move = { x: 0, y: 0, mag: 0 };

  function setMove(x, y) { move.x = x; move.y = y; move.mag = Math.min(1, Math.hypot(x, y)); }
  function press(b) { btns[b].down = true; btns[b].pressed = true; }
  function hold(b) { btns[b].down = true; btns[b].pressed = false; }
  function release(b) { btns[b].down = false; btns[b].pressed = false; }
  function clearEdges() { for (const k in btns) if (btns[k] && btns[k].pressed !== undefined) btns[k].pressed = false; }

  // Step the controller only. Camera yaw pinned to 0 so +y on the stick is +z
  // in the world and the numbers are readable.
  function step(n, yaw = 0, aimPitch = 0) {
    for (let i = 0; i < n; i++) {
      P.update(DT, move, btns, yaw, aimPitch);
      H.update(DT, btns, move);
      clearEdges();
      P.drainEvents(); H.drainEvents();
    }
  }
  const snap = (label) => ({
    label,
    state: P.state,
    y: +P.position.y.toFixed(2),
    z: +P.position.z.toFixed(2),
    speed: +Math.hypot(P.velocity.x, P.velocity.z).toFixed(2),
    vy: +P.velocity.y.toFixed(2),
    grounded: P.grounded,
    momentum: +P.momentum.toFixed(2),
  });

  const r = {};

  // ── 0. STICK DIRECTION vs the camera ────────────────────────────────────
  // The one that got shipped broken. Every other movement check here passed
  // while forward ran backwards, because they all measured DISTANCE and never
  // direction. Push the stick four ways at several camera angles and assert
  // she goes where the screen says.
  //
  //   camera at  focus + (sin yaw, cos yaw) * dist  =>  forward = (-sin, -cos)
  //                                                     right   = ( cos, -sin)
  const dirs = [];
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.7]) {
    for (const [name, sx, sy] of [['fwd',0,1], ['back',0,-1], ['right',1,0], ['left',-1,0]]) {
      P.teleport(0, L.terrainHeight(0, 0) + 0.5, 0);
      setMove(0, 0); step(90, yaw);
      const x0 = P.position.x, z0 = P.position.z;
      setMove(sx, sy); step(90, yaw);
      const dx = P.position.x - x0, dz = P.position.z - z0;
      const len = Math.hypot(dx, dz) || 1e-9;

      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      const rx =  Math.cos(yaw), rz = -Math.sin(yaw);
      const ex = sx * rx + sy * fx, ez = sx * rz + sy * fz;   // expected unit dir
      const dot = (dx / len) * ex + (dz / len) * ez;          // 1 = perfect
      dirs.push({ yaw: +yaw.toFixed(2), push: name, dot: +dot.toFixed(3), moved: +len.toFixed(2) });
    }
  }
  // Independent cross-check, free of the algebra above: pushing FORWARD must
  // increase the distance from the camera, and BACK must decrease it. That is
  // the thing the player actually perceives, and it can't both-ways-cancel if
  // my derivation of F and R is itself wrong.
  const away = [];
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.7]) {
    for (const [name, sy, want] of [['fwd', 1, +1], ['back', -1, -1]]) {
      P.teleport(0, L.terrainHeight(0, 0) + 0.5, 0);
      setMove(0, 0); step(90, yaw);
      // where the follow cam would sit for this yaw
      const cx = P.position.x + Math.sin(yaw) * 6.3;
      const cz = P.position.z + Math.cos(yaw) * 6.3;
      const d0 = Math.hypot(P.position.x - cx, P.position.z - cz);
      setMove(0, sy); step(90, yaw);
      const d1 = Math.hypot(P.position.x - cx, P.position.z - cz);
      away.push({ yaw: +yaw.toFixed(2), push: name, delta: +(d1 - d0).toFixed(2), sign: Math.sign(d1 - d0) === want ? 1 : -1 });
    }
  }
  r.worstAwayDot = Math.min(...away.map((a) => a.sign));

  r.stickDirs = dirs;
  r.worstStickDot = Math.min(...dirs.map((d) => d.dot));
  r.minStickMove  = Math.min(...dirs.map((d) => d.moved));

  // ── 1. top speed and the acceleration curve ──────────────────────────────
  P.teleport(0, L.terrainHeight(0, 0) + 0.5, 0);
  step(60); // settle onto the ground
  setMove(0, 1);
  const accel = [];
  for (const t of [0.25, 0.5, 1, 2, 3, 4]) {
    const target = Math.round(t * 120);
    const already = accel.length ? Math.round(accel[accel.length - 1].t * 120) : 0;
    step(target - already);
    accel.push({ t, speed: +Math.hypot(P.velocity.x, P.velocity.z).toFixed(2), momentum: +P.momentum.toFixed(2) });
  }
  r.accel = accel;
  r.topSpeed = accel[accel.length - 1].speed;

  // ── 2. stopping distance ────────────────────────────────────────────────
  const z0 = P.position.z;
  setMove(0, 0);
  step(120);
  r.stopDistance = +Math.abs(P.position.z - z0).toFixed(2);
  r.stoppedSpeed = +Math.hypot(P.velocity.x, P.velocity.z).toFixed(3);

  // ── 3. jump height and airtime from a standstill ────────────────────────
  P.teleport(0, L.terrainHeight(0, 0) + 0.5, 0);
  step(60);
  const groundY = P.position.y;
  press('jump');
  step(1);
  release('jump');
  let peak = P.position.y, airFrames = 0;
  while (!P.grounded && airFrames < 600) { step(1); peak = Math.max(peak, P.position.y); airFrames++; }
  r.jumpHeight = +(peak - groundY).toFixed(2);
  r.jumpAirtime = +(airFrames / 120).toFixed(2);

  // ── 4. running jump distance ────────────────────────────────────────────
  P.teleport(0, L.terrainHeight(0, 0) + 0.5, 0);
  step(60);
  setMove(0, 1);
  step(360); // build to full momentum
  const jz = P.position.z;
  press('jump');
  step(1);
  release('jump');
  let f = 0;
  while (!P.grounded && f < 600) { step(1); f++; }
  r.runJumpDistance = +Math.abs(P.position.z - jz).toFixed(2);
  r.runJumpSpeed = +r.topSpeed;

  // ── 5. coyote time: walk off a ledge, jump late ─────────────────────────
  // Stand on the tallest stair crate and run off the edge.
  P.teleport(18.6, 12, -8);
  setMove(0, 0);
  step(240);
  const onCrate = P.grounded ? P.position.y : null;
  setMove(1, 0);
  step(90);
  // now airborne off the side; wait 0.08s (inside the 0.12s window) then jump
  let leftAt = null, i = 0;
  while (P.grounded && i < 240) { step(1); i++; }
  leftAt = P.position.y;
  step(10); // 0.083s after leaving
  press('jump');
  step(1);
  release('jump');
  r.coyoteWorked = P.velocity.y > 4;
  r.coyoteLedgeY = onCrate;

  // ── 6. step-up: the three stair crates ──────────────────────────────────
  // Crate tops are exported by the level, so this asserts against the actual
  // rises rather than against where the terrain noise happened to put them.
  const stepTest = [];
  {
    const tops = window.stairTops;                 // [ground, +0.35, +0.50, +0.70]
    const bx = 12, bz = -8;
    for (let i = 0; i < 3; i++) {
      const rise = +(tops[i + 1] - tops[i]).toFixed(2);
      // start standing on the previous surface, 1.4m short of the next crate
      const sx = bx + i * 2.0 - 2.3;
      P.teleport(sx, tops[i] + 0.3, bz);
      setMove(0, 0); step(180);
      const y0 = P.position.y;
      setMove(1, 0); step(240);
      stepTest.push({
        rise,
        climbed: +(P.position.y - y0).toFixed(2),
        reachedTop: Math.abs(P.position.y - tops[i + 1]) < 0.12,
      });
    }
  }
  r.stepUp = stepTest;

  // ── 7. steep slope should slide, not climb ──────────────────────────────
  // The spire island: radius 22, height 16, plateau 0.10 => a steep cone.
  P.teleport(-46 + 9, 6, 52);
  setMove(0, 0); step(120);
  const slopeY0 = P.position.y;
  setMove(-1, 0); // push straight at the spire
  step(360);
  r.steepSlopeGain = +(P.position.y - slopeY0).toFixed(2);
  r.steepNormalY = +L.groundAt(-46 + 6, 52, Infinity, {}).normal.y.toFixed(2);

  // ── 8. water: enter, float, dive, surface ───────────────────────────────
  const water = [];
  P.teleport(-4, 8, -70);
  setMove(0, 0);
  step(240);
  water.push(snap('after falling in'));
  const floatY = P.position.y;
  step(240);
  water.push(snap('floating 2s later'));
  r.floatDrift = +Math.abs(P.position.y - floatY).toFixed(2);

  press('dive');
  step(240);
  water.push(snap('diving 2s'));
  r.diveDepth = +(0 - P.position.y).toFixed(2);
  release('dive');

  // rise back with jump held
  press('jump');
  step(360);
  water.push(snap('rising 3s'));
  release('jump');
  step(120);
  water.push(snap('settled'));
  r.water = water;

  // count state flips over 3 seconds of holding dive, to catch ping-pong
  P.teleport(-4, -1, -70);
  step(60);
  press('dive');
  let flips = 0, prev = P.state;
  for (let k = 0; k < 360; k++) { step(1); if (P.state !== prev) { flips++; prev = P.state; } }
  release('dive');
  r.diveStateFlips = flips;

  // ── 9. wading out of the sea onto the beach ─────────────────────────────
  P.teleport(4, 0, -46);
  setMove(0, 0); step(120);
  const wadeStart = P.state;
  setMove(0, 1);          // "forward"...
  step(600, Math.PI);     // ...with the camera turned so forward IS inland
  r.wade = { start: wadeStart, end: P.state, y: +P.position.y.toFixed(2), grounded: P.grounded };

  // ── 10. the hook: swing off a mast anchor ───────────────────────────────
  const mastAnchor = L.grapplePoints
    .filter((g) => g.kind === 'swing')
    .sort((a, b) => a.pos.distanceTo(new THREE.Vector3(-4, 8, 18)) - b.pos.distanceTo(new THREE.Vector3(-4, 8, 18)))[0];
  P.teleport(mastAnchor.pos.x, mastAnchor.pos.y - 6, mastAnchor.pos.z);
  P.state = 'air';
  setMove(0, 0);
  // aim straight up at it
  F.camera.position.set(P.position.x, P.position.y - 3, P.position.z + 4);
  F.camera.lookAt(mastAnchor.pos);
  F.camera.updateMatrixWorld(true);
  press('hook');
  step(1);
  release('hook');
  step(90);
  const hookAfterFire = H.state;
  step(240);
  r.hook = {
    anchorY: +mastAnchor.pos.y.toFixed(2),
    stateAfterFire: hookAfterFire,
    stateLater: H.state,
    peggyState: P.state,
    swung: +Math.hypot(P.velocity.x, P.velocity.z).toFixed(2),
    ropeLength: +(H.ropeLength || 0).toFixed(2),
  };

  // ── 11. never fall through the world ────────────────────────────────────
  // Drop her from high up over a hundred scattered spots and confirm she always
  // ends up resting on or above the sampled ground.
  let below = 0, checked = 0;
  for (let a = 0; a < 100; a++) {
    const x = (a % 10) * 12 - 54, z = Math.floor(a / 10) * 12 - 54;
    P.teleport(x, 40, z);
    setMove(0, 0);
    step(600);
    const g = L.groundAt(P.position.x, P.position.z, Infinity, {});
    checked++;
    if (P.state !== 'swim' && P.state !== 'dive' && P.position.y < g.y - 0.15) below++;
  }
  r.fellThrough = { checked, below };

  // ── camera: fixed tilt, and recentre ────────────────────────────────────
  const p0 = F.pitch;
  F.update(1 / 120, P, { x: 0, y: 1, mag: 1 });    // shove the look stick UP
  F.update(1 / 120, P, { x: 0, y: -1, mag: 1 });   // ...and DOWN
  r.pitchFixed = Math.abs(F.pitch - p0) < 1e-9;

  P.teleport(0, L.terrainHeight(0, 0) + 0.5, 0);
  P.facing = 1.2;
  F.targetYaw = F.yaw = 1.2 + Math.PI + 2.0;       // knock it well off-centre
  F.recentre(P);
  for (let i = 0; i < 240; i++) F.update(1 / 120, P, { x: 0, y: 0, mag: 0 });
  const off = Math.abs(Math.atan2(Math.sin(F.yaw - (P.facing + Math.PI)),
                                  Math.cos(F.yaw - (P.facing + Math.PI))));
  r.recentreWorks = off < 0.05;

  // ── melee: swing fires, lunges forward, and has reach ───────────────────
  P.teleport(6, L.terrainHeight(6, 4) + 0.5, 4);
  setMove(0, 0); step(180);
  P.facing = 0;                                   // face +z
  const mx0 = P.position.z, mSpeed0 = Math.hypot(P.velocity.x, P.velocity.z);
  press('melee'); step(1); release('melee');
  const swungFor = P.meleeTimer;
  const lunge = Math.hypot(P.velocity.x, P.velocity.z);
  // a point 1.5m straight ahead must be inside the arc; one behind must not
  const hitsFront = P.meleeHits(P.position.x, P.position.y, P.position.z + 1.5);
  const hitsBack  = P.meleeHits(P.position.x, P.position.y, P.position.z - 1.5);
  const hitsFar   = P.meleeHits(P.position.x, P.position.y, P.position.z + 6.0);
  step(90);
  r.melee = {
    fired: swungFor > 0,
    lungeSpeed: +lunge.toFixed(2),
    hitsFront, hitsBack, hitsFar,
    endsAfterSwing: P.meleeTimer === 0,
  };

  return r;
});

await browser.close();

// ── expectations ──────────────────────────────────────────────────────────
// Ranges, not exact values: floating-point integration over thousands of steps
// is deterministic but not something to pin to four decimal places.
const checks = [
  ['stick goes where screen says',  out.worstStickDot, 0.97, 1.01],
  ['forward moves AWAY from camera', out.worstAwayDot, 0.97, 1.01],
  ['every push actually moves her',  out.minStickMove, 0.5, 99],
  ['top speed 6.5 m/s',            out.topSpeed, 6.3, 6.7],
  ['reaches top speed by 2s',      out.accel.find((a) => a.t === 2).speed, 6.0, 6.7],
  ['starts at a jog, not a crawl', out.accel[0].speed, 0.9, 2.2],
  ['jump height ~1.6m',            out.jumpHeight, 1.45, 1.75],
  ['jump airtime ~0.67s',          out.jumpAirtime, 0.55, 0.80],
  ['running jump clears 4.2m gap', out.runJumpDistance, 4.25, 5.2],
  ['stops within 2m',              out.stopDistance, 0.8, 2.2],
  ['dives at least 6m down',       out.diveDepth, 6, 40],
  ['floats without drifting',      out.floatDrift, 0, 0.05],
  ['slides DOWN the steep spire',  out.steepSlopeGain, -60, -1.0],
  ['spire really is steep',        out.steepNormalY, 0, 0.62],
];

const bools = [
  ['coyote time fires',                 out.coyoteWorked === true],
  ['0.35m lip is walkable',             out.stepUp[0].climbed > 0.30],
  ['0.50m lip is walkable',             out.stepUp[1].climbed > 0.45],
  ['0.70m lip BLOCKS (must jump)',      out.stepUp[2].climbed < 0.10],
  ['dive does not ping-pong',           out.diveStateFlips <= 2],
  ['wading out returns you to ground',  out.wade.end === 'ground' && out.wade.grounded],
  ['hook latches and swings',           out.hook.stateAfterFire === 'swinging'],
  ['camera tilt is fixed',              out.pitchFixed],
  ['tap-left recentres the camera',     out.recentreWorks],
  ['melee flick fires a swing',         out.melee.fired],
  ['melee lunges forward',              out.melee.lungeSpeed > 3],
  ['melee reaches in front',            out.melee.hitsFront],
  ['melee does NOT hit behind',         !out.melee.hitsBack],
  ['melee does NOT hit out of range',   !out.melee.hitsFar],
  ['melee swing ends',                  out.melee.endsAfterSwing],
  ['swing holds the rope',              out.hook.stateLater === 'swinging' && out.hook.ropeLength > 1],
  ['never falls through the world',     out.fellThrough.below === 0],
  ['no console errors',                 errors.filter((e) => !/peggy\.glb|404/.test(e)).length === 0],
];

let failed = 0;
const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n);
console.log('');
for (const [name, value, lo, hi] of checks) {
  const ok = value >= lo && value <= hi;
  if (!ok) failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${pad(name, 34)} ${String(value).padStart(8)}   [${lo}..${hi}]`);
}
for (const [name, ok] of bools) {
  if (!ok) failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${pad(name, 34)}`);
}
console.log('');
if (missing.length) console.log('  missing files (peggy.glb is expected):',
  [...new Set(missing.map((u) => u.split('/').pop()))].join(', '));
if (errors.length) console.log('  console errors:', errors.join(' | '));
console.log(failed ? `  ${failed} CHECK(S) FAILED` : '  all checks passed');
console.log('');
process.exit(failed ? 1 : 0);
