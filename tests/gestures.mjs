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

const URL = process.argv[2] || 'http://localhost:8123/index.html?world=island';

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
  const shots0 = window.cannon.shots;
  const yaw0 = window.follow.yaw;

  zone.dispatchEvent(mk('touchstart', x0, y0));
  // Drive the travel by WALL CLOCK, not by a fixed step count. On a starved
  // main thread (SwiftShader in CI) per-step sleeps stretch, and a
  // step-counted "110ms flick" gets DELIVERED as a 300ms drag — which the
  // classifier then, correctly, refuses to call a flick. A real screen under
  // load does what this version does: same duration, fewer, bigger deltas.
  const t0 = performance.now();
  let lastEv = t0, maxGap = 0;
  const mark = () => { const n = performance.now(); maxGap = Math.max(maxGap, n - lastEv); lastEv = n; };
  for (;;) {
    await sleep(8);
    const el = performance.now() - t0;
    const p = Math.min(1, el / ms);
    const jx = jit ? Math.sin(el * 0.015) * jit : 0;
    const jy = jit ? Math.cos(el * 0.011) * jit : 0;
    window.dispatchEvent(mk('touchmove', x0 + dist * p + jx, y0 + jy));
    mark();
    if (p >= 1) break;
  }
  // A QUICK lift (hold <= 100ms) is not stillness — a decelerating thumb
  // keeps smearing a couple of pixels until it leaves the glass. Deliver that
  // micro-motion through the whole tail: without it, a jank-stretched tail
  // accumulates 400ms of dead rest at full deflection, the aim-hold ENGAGES
  // mid-gesture, and release (correctly, by the aim's own rules) throws the
  // hook — failing the test's label for reasons that are pure scheduling.
  if (hold && hold <= 100) {
    const h0 = performance.now();
    let wig = 0;
    for (;;) {
      await sleep(28);
      if (performance.now() - h0 >= hold) break;
      window.dispatchEvent(mk('touchmove', x0 + dist + (++wig % 2 ? 2.2 : -2.2), y0));
      mark();
    }
    window.dispatchEvent(mk('touchmove', x0 + dist + 2.2, y0));
    mark();
  } else if (hold) {
    await sleep(hold);
    lastEv = performance.now();   // an intended rest is not a stall
  }
  window.dispatchEvent(mk('touchend', x0 + dist + (hold && hold <= 100 ? 2.2 : 0), y0));
  mark();
  // Buffered camera pixels are applied by the frame loop — wait for two real
  // frames before reading yaw, or a starved rAF makes a perfectly good pan
  // measure as a camera that never moved.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  await sleep(30);
  return { ...window.__c, shots: window.cannon.shots - shots0, gest: window.input.stickR.lastGesture, yaw: window.follow.yaw - yaw0, maxGap: Math.round(maxGap) };
}, { dist, ms, hold, jit });

const reset = async () => {
  await page.evaluate(() => {
    window.peggy.teleport(6, window.level.terrainHeight(6, 4) + 0.5, 4);
    window.peggy.meleeTimer = 0; window.peggy._meleeCd = 0;
    window.hook.state = 'idle'; window.peggy.hookOverride = null;
  });
  await page.waitForTimeout(420);
};

// THE SHOOT STICK. Its DIRECTION is the aim: push and she turns that way, the
// camera swings behind it, and the weapon commits there. Deflection is the
// whole verb, so a thumb resting at centre is nothing at all. A snap that
// releases fast is still the melee flick — the trigger waits out the
// flick-candidate window, so a flick never fires a stray round — and taps
// still jump. The camera only moves when the TRIGGER is down.
//                name                          px   ms  hold  jit   expect  camera-must
const CASES = [
  ['fast flick    90px /  70ms',                90,   70,   0,  0, 'flick', 'still'],
  ['human flick  110px / 110ms',               110,  110,   0,  0, 'flick', 'still'],
  ['lazy flick   130px / 170ms',               130,  170,   0,  0, 'flick', 'still'],
  ['deliberate push + hold = fire',            110,  400, 500,  0, 'shoot', 'moved'],
  ['snap out + hold = fire, no melee',         120,   80, 550,  0, 'shoot', 'moved'],
  ['steered fire: push, then travel',          200,  700, 350,  0, 'shoot', 'moved'],
  ['hold centre 600ms is nothing',               0,  200, 400,  6, 'drag',  'still'],
  ['tap          40ms, no travel',               0,   40,   0,  0, 'tap',   'still'],
];

const rows = [];
let failed = 0;
for (const [name, d, ms, hold, jit, want, cam] of CASES) {
  // The dispatcher measures its own worst gap between delivered events. If a
  // case FAILS and the delivery stalled >150ms mid-gesture, the input the
  // classifier saw was not the input the case describes (a real screen never
  // pauses a moving thumb's events) — so the case re-runs instead of judging
  // the classifier on a corrupted delivery. A case that fails with CLEAN
  // delivery still fails: this only forgives the harness, never the game.
  let r, verbOk, camOk, ok;
  for (let attempt = 0; attempt < 3; attempt++) {
    await reset();
    r = await gesture(d, ms, hold, jit);
    verbOk = r.gest === want
      && (want !== 'flick' || (r.melee === 1 && r.shots === 0))
      && (want !== 'shoot' || (r.shots >= 1 && r.melee === 0 && r.hook === 0))
      && (want !== 'tap' || (r.jump === 1 && r.shots === 0))
      && (want !== 'drag' || (r.melee === 0 && r.hook === 0 && r.jump === 0 && r.shots === 0));
    camOk = cam === 'any'
      || (cam === 'still' ? Math.abs(r.yaw) < 0.06 : Math.abs(r.yaw) > 0.05);
    ok = verbOk && camOk;
    if (ok || r.maxGap <= 150) break;
    console.log(`  ....  ${name.padEnd(34)} re-run: delivery stalled ${r.maxGap}ms`);
  }
  if (!ok) failed++;
  rows.push(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(34)} got=${(r.gest || '-').padEnd(6)} `
    + `melee=${r.melee} shots=${r.shots} jump=${r.jump} cam=${r.yaw.toFixed(3)}  want=${want}/${cam}`);
}

// ── the weapon swap ─────────────────────────────────────────────────────────
// Tap the button: the SAME push+hold now loads the harpoon and fires it on
// RELEASE — zero cannon shots. Tap it again: the cannon is back.
{
  await reset();
  await page.evaluate(() => {
    document.getElementById('weapon-btn')
      .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
  });
  const fires0 = await page.evaluate(() => window.hook.fires);
  // the tap lands on the NEXT sampled frame — poll for the class, don't race it
  const r1 = await page.waitForFunction(
    () => document.getElementById('weapon-btn').classList.contains('hook'),
    null, { timeout: 3000 }
  ).then(() => true).catch(() => false);
  const g1 = await gesture(110, 400, 500, 0);
  const fires1 = await page.evaluate(() => window.hook.fires);
  const hookOk = r1 && g1.shots === 0 && fires1 === fires0 + 1;
  if (!hookOk) failed++;
  rows.push(`  ${hookOk ? 'PASS' : 'FAIL'}  ${'swap: hold+release throws the hook'.padEnd(34)} `
    + `btn=${r1} shots=${g1.shots} throws=${fires1 - fires0}  want=throw/no-shots`);

  await reset();
  await page.evaluate(() => {
    document.getElementById('weapon-btn')
      .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
  });
  await page.waitForFunction(
    () => !document.getElementById('weapon-btn').classList.contains('hook'),
    null, { timeout: 3000 }
  ).catch(() => {});
  const g2 = await gesture(110, 400, 500, 0);
  const backOk = g2.shots >= 1;
  if (!backOk) failed++;
  rows.push(`  ${backOk ? 'PASS' : 'FAIL'}  ${'swap back: the cannon returns'.padEnd(34)} `
    + `shots=${g2.shots}  want=shots`);
}

await browser.close();
console.log('');
console.log(rows.join('\n'));
console.log('');
if (errors.length) { console.log('  console errors:', errors.join(' | ')); failed++; }
console.log(failed ? `  ${failed} GESTURE CHECK(S) FAILED` : '  all gesture checks passed');
console.log('');
process.exit(failed ? 1 : 0);
