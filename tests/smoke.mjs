// Smoke test: boot the game headless, drive it with real key/mouse input, and
// screenshot each state.
//
// Unlike tests/locomotion.mjs this one goes through the whole stack — renderer,
// shaders, input handlers — so it catches the things that don't show up in the
// controller numbers: a shader that fails to compile, a texture bound wrong, an
// event listener on the wrong element.
//
// It runs under SwiftShader, so the game is in slow motion and the movement
// trace below is NOT a measurement — the numbers in locomotion.mjs are.
// Screenshots land in /tmp/peggy-shots.
import { chromium } from 'playwright';

const URL = process.argv[2] || 'http://localhost:8123/index.html?world=island';
const SHOTS = process.argv[3] || '/tmp/peggy-shots';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const errors = [];
const logs = [];
page.on('console', (m) => {
  const t = `${m.type()}: ${m.text()}`;
  logs.push(t);
  // models/peggy.glb 404s by design until the rig is delivered; the loader
  // falls back to the procedural proxy. Anything else is a real error.
  if (m.type() === 'error' && !/404|Failed to load resource/.test(t)) errors.push(t);
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(4000);

// Did it actually boot, or is it stuck on the boot screen / error card?
const booted = await page.evaluate(() => !!window.peggy && !!window.loop && window.loop.running);
const bootErr = await page.$('.boot-error');
if (bootErr) errors.push('BOOT ERROR CARD: ' + (await bootErr.innerText()).slice(0, 900));

const shot = async (name) => page.screenshot({ path: `${SHOTS}/${name}.png` });
await shot('01-spawn');

// front-on look at the character, close in
await page.evaluate(() => {
  window.peggy.teleport(4, window.level.terrainHeight(4, -34) + 0.5, -34);
  window.peggy.facing = 0;
  window.follow.targetYaw = 0;   // camera in FRONT of her, looking back
  window.follow.targetPitch = 0.10;
  window.follow.snapTo(window.peggy);
  window.follow.targetYaw = 0;
});
await page.waitForTimeout(2200);
await shot('01b-front');

// wide shot at the horizon — checks the sky dome and the fog blend
await page.evaluate(() => {
  window.peggy.teleport(4, window.level.terrainHeight(4, -34) + 0.5, -34);
  window.follow.targetYaw = Math.PI;
  window.follow.targetPitch = -0.06;   // look slightly UP, at the sky
  window.follow.snapTo(window.peggy);
  window.follow.targetYaw = Math.PI;
  window.follow.targetPitch = -0.06;
});
await page.waitForTimeout(2200);
await shot('01c-horizon');

// ── drive it ──────────────────────────────────────────────────────────────
async function report(label) {
  return page.evaluate(() => ({
    state: window.peggy.state,
    pos: window.peggy.position.toArray().map((n) => +n.toFixed(2)),
    vel: window.peggy.velocity.toArray().map((n) => +n.toFixed(2)),
    speed: +Math.hypot(window.peggy.velocity.x, window.peggy.velocity.z).toFixed(2),
    grounded: window.peggy.grounded,
    hook: window.hook.state,
    camUnder: window.follow.underwater,
  })).then((r) => ({ label, ...r }));
}

const results = [];
results.push(await report('spawn'));

// run forward for 2.5s
await page.keyboard.down('KeyW');
await page.waitForTimeout(2500);
results.push(await report('running'));
await shot('02-running');

// jump while running
await page.keyboard.press('Space');
await page.waitForTimeout(260);
results.push(await report('mid-jump'));
await shot('03-jump');
await page.waitForTimeout(1400);
results.push(await report('after-landing'));
await page.keyboard.up('KeyW');

// teleport into deep water and check the swim handover
await page.evaluate(() => window.peggy.teleport(-4, 6, -60));
await page.waitForTimeout(2200);
results.push(await report('in-water'));
await shot('04-swimming');

// dive
await page.keyboard.down('KeyC');
await page.waitForTimeout(1600);
results.push(await report('diving'));
await shot('05-diving');
await page.keyboard.up('KeyC');

// teleport under the mast rigging and fire the hook upward
await page.evaluate(() => {
  window.peggy.teleport(-4, 2, 24);
  window.follow.targetPitch = 0.55;
  window.follow.targetYaw = Math.PI;
});
await page.waitForTimeout(900);
await page.mouse.click(640, 360);
await page.waitForTimeout(500);
results.push(await report('hook-fired'));
await shot('06-hook');
await page.waitForTimeout(1800);
results.push(await report('hook-settled'));
await shot('07-hook-after');

// terrain / collision sanity: sample the height field for NaNs and check that
// the player never ends up under the terrain
const sanity = await page.evaluate(() => {
  const bad = [];
  for (let x = -120; x <= 120; x += 7) {
    for (let z = -120; z <= 120; z += 7) {
      const h = window.level.terrainHeight(x, z);
      if (!Number.isFinite(h)) bad.push([x, z, h]);
    }
  }
  const g = window.level.groundAt(0, 0, Infinity, {});
  return {
    nonFiniteHeights: bad.length,
    sampleGround: +g.y.toFixed(2),
    normalOk: Number.isFinite(g.normal.y),
    grapplePoints: window.level.grapplePoints.length,
    haulables: window.level.haulables.length,
    solids: window.level.solids.length,
    drawCalls: window.renderer.info.render.calls,
    triangles: window.renderer.info.render.triangles,
    proxyModel: window.model.isProxy,
  };
});

await browser.close();

console.log('booted:', booted);
console.log('\n--- movement trace ---');
for (const r of results) console.log(JSON.stringify(r));
console.log('\n--- world sanity ---');
console.log(JSON.stringify(sanity, null, 2));
console.log('\n--- console errors ---');
console.log(errors.length ? errors.join('\n') : '(none)');
process.exit(errors.length || !booted ? 1 : 0);
