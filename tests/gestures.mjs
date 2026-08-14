// Gesture separation test.
//
// The right stick carries four verbs on one thumb. Every time the thresholds
// have been wrong, the bug reached a real device and not one of the other
// tests noticed — because the controller was fine and the INPUT layer was
// mis-classifying. This file exists to catch that.
//
// It dispatches real TouchEvents at ~8ms intervals, the way a screen does, and
// at HUMAN speeds. That last part is the whole point: the first version of the
// flick detector passed a synthetic test that flicked in 48ms and then fired
// melee on every ordinary camera drag, because a person's drag crosses the same
// distance well inside the window the test never probed.
//
// Cases that have actually shipped broken, and are now pinned:
//   * a slow drag firing melee          (flick was time-windowed, not speed-based)
//   * a hold never firing the hook      (hold zone tighter than thumb wobble)
//   * a flick whipping the camera       (no post-flick mute)

import { chromium } from 'playwright';

const URL = process.argv[2] || 'http://localhost:8123/index.html';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const ctx = await browser.newContext({
  viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true,
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errors.push(m.text());
});

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => window.peggy && window.loop && window.loop.running, null, { timeout: 30000 });
await page.waitForTimeout(900);

await page.evaluate(() => {
  window.__c = { melee: 0, hook: 0, jump: 0 };
  const j = window.input.stickR;
  const f = j.onFlick, h = j.onHoldRelease, t = j.onTap;
  j.onFlick = (a) => { window.__c.melee++; f && f(a); };
  j.onHoldRelease = () => { window.__c.hook++; h && h(); };
  j.onTap = () => { window.__c.jump++; t && t(); };
});

/**
 * @param dist  px travelled from the touch-down point
 * @param ms    how long that travel takes (this is what separates flick from drag)
 * @param hold  extra ms held at the end before lifting
 * @param jit   px of wobble, to imitate a thumb resting on glass
 */
const gesture = (dist, ms, hold, jit = 0) => page.evaluate(async ({ dist, ms, hold, jit }) => {
  const zone = document.getElementById('zone-right');
  const mk = (type, x, y) => {
    const t = new Touch({ identifier: 9, target: zone, clientX: x, clientY: y });
    return new TouchEvent(type, { touches: [t], targetTouches: [t], changedTouches: [t], bubbles: true, cancelable: true });
  };
  const sleep = (m) => new Promise((r) => setTimeout(r, m));
  const x0 = 650, y0 = 200;
  const steps = Math.max(1, Math.round(ms / 8));   // ~120Hz, like a real screen
  window.__c = { melee: 0, hook: 0, jump: 0 };
  const yaw0 = window.follow.yaw;

  zone.dispatchEvent(mk('touchstart', x0, y0));
  for (let i = 1; i <= steps; i++) {
    await sleep(8);
    const p = i / steps;
    const jx = jit ? Math.sin(i * 2.3) * jit : 0;
    const jy = jit ? Math.cos(i * 1.7) * jit : 0;
    window.dispatchEvent(mk('touchmove', x0 + dist * p + jx, y0 + jy));
  }
  if (hold) await sleep(hold);
  window.dispatchEvent(mk('touchend', x0 + dist, y0));
  await sleep(60);
  return { ...window.__c, gest: window.input.stickR.lastGesture, yaw: window.follow.yaw - yaw0 };
}, { dist, ms, hold, jit });

const reset = async () => {
  await page.evaluate(() => {
    window.peggy.teleport(6, window.level.terrainHeight(6, 4) + 0.5, 4);
    window.peggy.meleeTimer = 0; window.peggy._meleeCd = 0;
    window.hook.state = 'idle'; window.peggy.hookOverride = null;
  });
  await page.waitForTimeout(420);
};

//                name                        px   ms  hold  jit   expect  camera-must
const CASES = [
  ['fast flick    90px /  70ms',              90,   70,   0,  0, 'flick', 'still'],
  ['human flick  110px / 110ms',             110,  110,   0,  0, 'flick', 'still'],
  ['lazy flick   130px / 170ms',             130,  170,   0,  0, 'flick', 'still'],
  ['slow drag    110px / 400ms',             110,  400,   0,  0, 'drag',  'moved'],
  ['slow drag    150px / 700ms',             150,  700,   0,  0, 'drag',  'moved'],
  ['creeping drag 70px / 600ms',              70,  600,   0,  0, 'drag',  'any'],
  ['hold still   600ms, 6px wobble',           0,  200, 400,  6, 'hold',  'still'],
  ['hold sloppy  700ms, 12px wobble',          0,  250, 450, 12, 'hold',  'still'],
  ['tap          40ms, no travel',             0,   40,   0,  0, 'tap',   'still'],
];

const rows = [];
let failed = 0;
for (const [name, d, ms, hold, jit, want, cam] of CASES) {
  await reset();
  const r = await gesture(d, ms, hold, jit);
  const verbOk = r.gest === want
    && (want !== 'flick' || r.melee === 1)
    && (want !== 'hook' || r.hook === 1)
    && (want !== 'hold' || r.hook === 1)
    && (want !== 'tap' || r.jump === 1)
    && (want !== 'drag' || (r.melee === 0 && r.hook === 0 && r.jump === 0));
  const camOk = cam === 'any'
    || (cam === 'still' ? Math.abs(r.yaw) < 0.02 : Math.abs(r.yaw) > 0.05);
  const ok = verbOk && camOk;
  if (!ok) failed++;
  rows.push(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(34)} got=${(r.gest || '-').padEnd(6)} `
    + `melee=${r.melee} hook=${r.hook} jump=${r.jump} cam=${r.yaw.toFixed(3)}  want=${want}/${cam}`);
}

await browser.close();
console.log('');
console.log(rows.join('\n'));
console.log('');
if (errors.length) { console.log('  console errors:', errors.join(' | ')); failed++; }
console.log(failed ? `  ${failed} GESTURE CHECK(S) FAILED` : '  all gesture checks passed');
console.log('');
process.exit(failed ? 1 : 0);
