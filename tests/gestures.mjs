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
  window.__c = { melee: 0, hook: 0, jump: 0 };
  const yaw0 = window.follow.yaw;

  zone.dispatchEvent(mk('touchstart', x0, y0));
  // Drive the travel by WALL CLOCK, not by a fixed step count. On a starved
  // main thread (SwiftShader in CI) per-step sleeps stretch, and a
  // step-counted "110ms flick" gets DELIVERED as a 300ms drag — which the
  // classifier then, correctly, refuses to call a flick. A real screen under
  // load does what this version does: same duration, fewer, bigger deltas.
  const t0 = performance.now();
  for (;;) {
    await sleep(8);
    const el = performance.now() - t0;
    const p = Math.min(1, el / ms);
    const jx = jit ? Math.sin(el * 0.015) * jit : 0;
    const jy = jit ? Math.cos(el * 0.011) * jit : 0;
    window.dispatchEvent(mk('touchmove', x0 + dist * p + jx, y0 + jy));
    if (p >= 1) break;
  }
  if (hold) await sleep(hold);
  // A QUICK lift (hold <= 100ms) smears a couple of pixels on a real screen.
  // Delivering that smear also keeps a jank-stretched tail from accumulating
  // 200ms of dead stillness at full deflection — which is, to the classifier,
  // a deliberate resting aim, and it would be right.
  const lift = hold && hold <= 100 ? 2.5 : 0;
  if (lift) window.dispatchEvent(mk('touchmove', x0 + dist + lift, y0));
  window.dispatchEvent(mk('touchend', x0 + dist + lift, y0));
  // Buffered camera pixels are applied by the frame loop — wait for two real
  // frames before reading yaw, or a starved rAF makes a perfectly good pan
  // measure as a camera that never moved.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  await sleep(30);
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

// The camera is swipe-based and the aim-hold works DEFLECTED (press and hold
// in a direction, release to launch — the requested gesture). That redraws the
// map: fast sustained travel is a pan; a push that then RESTS is an aim, no
// matter how far out it sits; a snap-and-release or snap-and-rebound is the
// flick. Slow creeps that settle are aims too — that's a feature, not a
// misdetection: the arc appears the moment the hold engages, so the player
// sees what release will do.
//                name                          px   ms  hold  jit   expect  camera-must
const CASES = [
  ['fast flick    90px /  70ms',                90,   70,   0,  0, 'flick', 'still'],
  ['human flick  110px / 110ms',               110,  110,   0,  0, 'flick', 'still'],
  ['lazy flick   130px / 170ms',               130,  170,   0,  0, 'flick', 'still'],
  ['fast pan     260px / 320ms, quick lift',   260,  320,  60,  0, 'drag',  'moved'],
  ['long pan     300px / 500ms, quick lift',   300,  500,  40,  0, 'drag',  'moved'],
  ['push out + REST + release = aim-throw',    110,  400, 320,  0, 'hold',  'any'],
  ['hold still   600ms, 6px wobble',             0,  200, 400,  6, 'hold',  'still'],
  ['hold sloppy  700ms, 12px wobble',            0,  250, 450, 12, 'hold',  'still'],
  ['tap          40ms, no travel',               0,   40,   0,  0, 'tap',   'still'],
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
    || (cam === 'still' ? Math.abs(r.yaw) < 0.06 : Math.abs(r.yaw) > 0.05);
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
