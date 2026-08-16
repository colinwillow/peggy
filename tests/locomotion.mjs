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

  // ── context interact: proximity + facing ────────────────────────────────
  {
    const chest = L.interactables.find((i) => i.icon === 'chest');
    const near = (dx, dz, facing) => {
      P.teleport(chest.pos.x + dx, chest.pos.y, chest.pos.z + dz);
      P.facing = facing;
      return !!L.findInteractable(P.position, facing);
    };
    // stand 1.6m south of it, facing north (+z) = toward it
    const toward = Math.atan2(0, 1);
    const away = Math.atan2(0, -1);
    r.interact = {
      facingIt: near(0, -1.6, toward),
      facingAway: near(0, -1.6, away),
      tooFar: near(0, -9.0, toward),
      onTopOfIt: near(0, -0.3, away),   // facing stops mattering up close
      count: L.interactables.length,
      icons: [...new Set(L.interactables.map((i) => i.icon))].sort(),
    };
    // once-only prompts stop offering themselves
    chest.used = true;
    r.interact.afterUse = near(0, -1.6, toward);
    chest.used = false;
  }

  // ── hook from the GROUND, at the mast ───────────────────────────────────
  // The case that was broken in play: standing on the island, facing the mast,
  // hold-release. It failed three ways at once — the aim pointed down so the
  // anchors fell outside the cone; the rope was long enough that the bottom of
  // the arc was underground; and the ground check bailed out on the very first
  // physics step because she was still stood on it.
  {
    P.teleport(-4, L.terrainHeight(-4, 24) + 0.4, 24);
    P.facing = Math.PI;
    F.targetYaw = F.yaw = P.facing + Math.PI;
    setMove(0, 0); step(90);
    F.update(1 / 120, P, { x: 0, y: 0, mag: 0 });

    const hand = H.handPosition(new THREE.Vector3());
    const aim = H.aimDirection(new THREE.Vector3());
    const found = L.findGrapplePoint(hand, aim, 17, 0.28);
    const groundY = P.position.y;

    press('hook'); step(1); release('hook');
    for (let i = 0; i < 200 && H.state === 'flying'; i++) step(1);
    const latched = H.state;

    const ys = [];
    for (let i = 0; i < 24; i++) { step(10); ys.push(P.position.y); }

    r.groundHook = {
      aimIsFlat: Math.abs(aim.y) < 0.01,
      foundAnchor: !!found,
      anchorAbove: found ? found.pos.y > hand.y + 3 : false,
      latched,
      stillSwinging: H.state === 'swinging',
      gained: +(Math.max(...ys) - groundY).toFixed(2),
      // a real pendulum goes up AND back down, it doesn't just rise
      oscillates: Math.max(...ys) - Math.min(...ys) > 1.0,
      ropeClearsGround: H.ropeLength < (found ? found.pos.y - groundY : 0),
    };
    press('hook'); step(3); release('hook');
    r.groundHook.releasedToAir = P.state === 'air';
  }

  // ── double jump ─────────────────────────────────────────────────────────
  {
    P.teleport(0, L.terrainHeight(0, 0) + 0.5, 0);
    setMove(0, 0); step(60);
    const gY = P.position.y;
    press('jump'); step(1); release('jump');
    step(60);                                   // past the apex, falling
    const vyBefore = P.velocity.y;
    press('jump'); step(1); release('jump');    // the double
    const vyDouble = P.velocity.y;
    // Let the double's speed decay well below the assertion threshold, so a
    // (correctly) blocked third press reads as "unchanged", not "fresh jump".
    step(30);
    press('jump'); step(1); release('jump');    // a third must do nothing
    const vyThird = P.velocity.y;
    let peak = P.position.y, guard = 0;
    while (!P.grounded && guard++ < 600) { step(1); peak = Math.max(peak, P.position.y); }
    // grounded again: the air jump must come back
    press('jump'); step(1); release('jump');
    step(30);
    press('jump'); step(1); release('jump');
    const vyRefreshed = P.velocity.y;
    r.doubleJump = {
      vyBefore: +vyBefore.toFixed(2),
      fired: vyDouble > 6,
      thirdBlocked: vyThird < 6,
      totalHeight: +(peak - gY).toFixed(2),
      refreshed: vyRefreshed > 6,
    };
  }

  // ── melee combo: forehand, backhand, spin ───────────────────────────────
  {
    P.teleport(6, L.terrainHeight(6, 4) + 0.5, 4);
    P.facing = 0;
    setMove(0, 0); step(120);
    P._meleeCd = 0; P._comboT = 0; P.meleeTimer = 0;
    const stages = [];
    const behindHits = [];
    for (let hit = 0; hit < 3; hit++) {
      press('melee'); step(1); release('melee');
      stages.push(P.meleeStage);
      behindHits.push(P.meleeHits(P.position.x, P.position.y, P.position.z - 1.5));
      // ride out the swing plus the chain beat, well inside the combo window
      while (P.meleeTimer > 0) step(1);
      step(16);
    }
    // let the window lapse, then swing again: must reset to stage 0
    step(200);
    press('melee'); step(1); release('melee');
    const resetStage = P.meleeStage;
    while (P.meleeTimer > 0) step(1);
    r.combo = {
      stages,
      spinHitsBehind: behindHits[2],
      earlyHitsBehindBlocked: !behindHits[0],
      resetsAfterWindow: resetStage === 0,
    };
  }

  // ── run + double jump distance vs the archipelago's final gap ───────────
  {
    P.teleport(0, L.terrainHeight(0, 0) + 0.5, 0);
    setMove(0, 0); step(60);
    setMove(0, 1); step(360);                    // full momentum
    const jz = P.position.z;
    press('jump'); step(1); release('jump');
    step(55);                                    // near the apex
    press('jump'); step(1); release('jump');     // double
    let guard = 0;
    while (!P.grounded && guard++ < 800) step(1);
    r.doubleJumpDistance = +Math.abs(P.position.z - jz).toFixed(2);
    // The course's last edge gap is 16.2m: clearable only with the double.
    r.lastGapNeedsDouble = r.runJumpDistance < 16.2 && r.doubleJumpDistance > 16.8;
  }

  // ── twin-stick face lock: run backwards while looking forward ───────────
  // While faceLock holds a yaw, travel must not steal her facing back.
  {
    P.teleport(0, L.terrainHeight(0, 0) + 0.5, 0);
    setMove(0, 0); step(60);
    P.facing = 0;
    P.faceLock = 0;                     // eyes on +Z...
    setMove(0, 1); step(240);           // ...feet running toward -Z
    const drift = Math.abs(Math.atan2(Math.sin(P.facing), Math.cos(P.facing)));
    r.faceLock = {
      held: drift < 0.08,
      moved: P.position.z < -3,
      speed: +Math.hypot(P.velocity.x, P.velocity.z).toFixed(2),
    };
    P.faceLock = null;
    setMove(0, 0); step(30);
  }

  // ── monkey bars: the hook latches ALONG the bar, not at its centre ──────
  {
    const bar = L.grapplePoints.find((gp) => gp.halfLen > 0);
    r.bars = { exists: !!bar };
    if (bar) {
      // stand near one END of the bar and aim straight at it
      const off = 1.3;                            // inside halfLen 1.7
      const from = new THREE.Vector3(bar.pos.x + off, bar.pos.y - 5, bar.pos.z - 2);
      const dir = new THREE.Vector3(0, 0, 1);
      const found = L.findGrapplePoint(from, dir, 17, 0.28);
      r.bars.found = found === bar;
      r.bars.latchNearThrow = found && Math.abs(found._latch.x - (bar.pos.x + off)) < 0.2;
      r.bars.latchNotCentre = found && Math.abs(found._latch.x - bar.pos.x) > 0.8;
    }
  }

  // ── crabs take a hit and go flying ──────────────────────────────────────
  {
    const crab = window.crabs[0];
    const hpBefore = crab.hp;
    crab.hit(1, 0, 12);
    r.crab = {
      count: window.crabs.length,
      lostHp: crab.hp === hpBefore - 1,
      launched: crab.vel.length() > 5,
    };
    // finish it: second hit pops it
    crab.hit(1, 0, 12);
    r.crab.dies = crab.dead === true;
    // put it back so nothing downstream sees a dead crab
    crab.dead = false; crab.hp = 2; crab.vel.set(0, 0, 0);
    crab.position.copy(crab.home); crab.root.visible = true; crab.root.scale.setScalar(1);
    crab._respawnT = 0; crab._popT = 0; crab.justDied = false;
  }

  r.coinCount = window.coins.length;

  // ── the cannon vs the world: barrels break, walls ricochet ──────────────
  // Steps Cannon.update() directly, same philosophy as everything above: the
  // main loop is paused while this evaluate runs, so the balls fly exactly
  // as many frames as we give them.
  {
    const C = window.cannon, loose = window.loose, W = window.water;
    const stepC = (n) => { for (let i = 0; i < n; i++) C.update(DT, { level: L, water: W, crabs: [], loose }); };
    const barrel = loose[0];
    const keep = { pos: barrel.position.clone(), hp: barrel.hp };

    // park it on the open beach and put two balls into it
    barrel.position.set(4, L.terrainHeight(4, -30) + 0.55, -30);
    barrel.vel.set(0, 0, 0);
    const coins0 = window.coins.length;
    C.fire(new THREE.Vector3(4, barrel.position.y, -33), new THREE.Vector3(0, 0, 1));
    stepC(60);
    const knocked = barrel.hp === keep.hp - 1 && barrel.vel.lengthSq() > 4;
    C.fire(new THREE.Vector3(4, barrel.position.y, -33), new THREE.Vector3(0, 0, 1));
    stepC(60);
    r.cannonWorld = {
      knocked,
      twoHitsBreak: barrel.dead === true,
      coinsPaid: window.coins.length - coins0,
    };

    // fire square at the tall crate past the stairs (x 17..19.4, z -9.2..-6.8):
    // the ball must come BACK (ricochet), never pass through to the far side
    const cy = L.terrainHeight(18.2, -11) + 0.6;
    C.fire(new THREE.Vector3(18.2, cy, -11), new THREE.Vector3(0, 0, 1));
    const ball = C._balls.find((b) => b.life > 0);
    let maxZ = -99, reversed = false;
    for (let i = 0; i < 240; i++) {
      stepC(1);
      if (ball.life > 0) {
        maxZ = Math.max(maxZ, ball.m.position.z);
        if (ball.vel.z < -0.5) reversed = true;
      }
    }
    r.cannonWorld.ricochetMaxZ = +maxZ.toFixed(2);
    r.cannonWorld.ricochet = reversed && maxZ < -6.8;

    // put the barrel back so nothing downstream sees a broken one
    barrel.dead = false; barrel.hp = keep.hp; barrel._popT = 0; barrel._respawnT = 0; barrel._growT = 0;
    barrel.position.copy(keep.pos); barrel.vel.set(0, 0, 0); barrel.spin.set(0, 0, 0);
    barrel.object3D.visible = true; barrel.object3D.scale.setScalar(1);
    barrel.object3D.rotation.set(0, 0, 0);
  }

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
  ['top speed 9.6 m/s',            out.topSpeed, 9.35, 9.85],
  ['reaches top speed by 2s',      out.accel.find((a) => a.t === 2).speed, 9.0, 9.85],
  ['starts at a jog, not a crawl', out.accel[0].speed, 0.9, 6.5],
  ['jump height ~2.6m',            out.jumpHeight, 2.35, 2.8],
  ['jump airtime ~1.0s',           out.jumpAirtime, 0.85, 1.15],
  ['running jump clears the 7m gap', out.runJumpDistance, 10.5, 12.5],
  ['run + double jump distance',   out.doubleJumpDistance, 10.6, 99],
  ['coasts to a stop within 5.5m', out.stopDistance, 3.0, 5.5],
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
  ['prompt shows when facing it',       out.interact.facingIt],
  ['prompt hides when facing away',     !out.interact.facingAway],
  ['prompt hides when too far',         !out.interact.tooFar],
  ['prompt shows point-blank',          out.interact.onTopOfIt],
  ['used-up prompt stops offering',     !out.interact.afterUse],
  ['three icon kinds in the level',     out.interact.icons.length === 3],
  ['hook aim is horizontal',            out.groundHook.aimIsFlat],
  ['finds the mast from the ground',    out.groundHook.foundAnchor],
  ['...and it is an overhead anchor',   out.groundHook.anchorAbove],
  ['latches into a SWING, not a whiff', out.groundHook.latched === 'swinging'],
  ['still swinging 2s later',           out.groundHook.stillSwinging],
  ['swing lifts her off the ground',    out.groundHook.gained > 2],
  ['swing actually oscillates',         out.groundHook.oscillates],
  ['rope shortened to clear ground',    out.groundHook.ropeClearsGround],
  ['releasing throws her into the air', out.groundHook.releasedToAir],
  ['double jump fires mid-air',         out.doubleJump.fired],
  ['third air jump is blocked',         out.doubleJump.thirdBlocked],
  ['air jump refreshes on landing',     out.doubleJump.refreshed],
  ['combo chains 0 -> 1 -> 2',          out.combo.stages.join('') === '012'],
  ['the spin hits all the way round',   out.combo.spinHitsBehind],
  ['the forehand does not hit behind',  out.combo.earlyHitsBehindBlocked],
  ['combo resets after the window',     out.combo.resetsAfterWindow],
  ['final gap needs the double jump',   out.lastGapNeedsDouble],
  ['face lock holds while running away', out.faceLock.held],
  ['...and she still actually runs',    out.faceLock.moved],
  ['monkey bars exist',                 out.bars.exists],
  ['bar latch lands near the throw',    out.bars.latchNearThrow],
  ['bar latch is not just the centre',  out.bars.latchNotCentre],
  ['a cannonball knocks a barrel',      out.cannonWorld.knocked],
  ['two balls stave the barrel in',     out.cannonWorld.twoHitsBreak],
  ['a broken barrel pays out coins',    out.cannonWorld.coinsPaid === 2],
  ['cannonballs ricochet off walls',    out.cannonWorld.ricochet],
  ['crabs spawn',                       out.crab.count >= 4],
  ['a melee hit costs a crab hp',       out.crab.lostHp],
  ['...and sends it flying',            out.crab.launched],
  ['two hits pops it',                  out.crab.dies],
  ['there are coins to collect',        out.coinCount > 15],
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
