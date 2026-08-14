// One intent struct, three sources.
//
// Touch, keyboard+mouse and gamepad all write into the SAME shape, so nothing
// downstream ever asks "are we on mobile?". Mobile-first means the touch layer
// defines what actions exist — everything a desktop player can do has to be
// reachable with two thumbs, and if it isn't, the design is wrong, not the
// input layer.
//
// The scheme, and why:
//
//   LEFT STICK is locomotion and nothing else. Drag to move; that's the whole
//   contract, and it's the one a player forms an expectation about in the first
//   two seconds. Tapping it RECENTRES THE CAMERA, so someone who only ever
//   wants to run around never has to involve their right thumb at all.
//
//   RIGHT STICK rotates the camera — horizontally ONLY. The tilt is fixed (see
//   FollowCamera.CAM.pitch). Giving up the vertical axis is the point: it frees
//   the right thumb's gestures for melee / shoot / interact, which is where the
//   verbs that don't exist yet are going to live.
//
//   NO ON-SCREEN BUTTONS. Every verb is a stick gesture, told apart by
//   deflection over time (see THE FOUR GESTURES in Joystick.js). Buttons cost
//   screen space, they cost a thumb leaving the stick, and they're slower than
//   a flick you can throw mid-run. The one real objection — that a flick also
//   drags the camera — is handled by muting the stick's camera contribution for
//   a beat after a flick fires, rather than by giving up and adding a button.
//
// Actions:
//   move      analogue, screen-space (+y is forward/up-screen)
//   look      analogue, camera yaw only (x); y is ignored
//   recentre  tap LEFT stick           / R      / L3
//   dive      flick LEFT stick down    / C      / B
//   jump      tap RIGHT stick          / Space  / A
//   melee     flick RIGHT stick        / LMB    / X      — hook swipe
//   hook      hold RIGHT stick, release / F     / RT     — throw the grapple

import { Joystick } from './Joystick.js';
import { clamp } from '../core/math.js';

class Button {
  constructor() { this.down = false; this.pressed = false; this.released = false; this._prev = false; }
  set(v) { this.down = !!v; }
  tap() { this._tapQueued = true; }
  edge() {
    this.pressed = (this.down && !this._prev) || !!this._tapQueued;
    this.released = !this.down && this._prev;
    this._prev = this.down;
    this._tapQueued = false;
  }
}

export class Input {
  constructor(dom) {
    this.move = { x: 0, y: 0, mag: 0 };
    this.look = { x: 0, y: 0, mag: 0 };
    this.jump = new Button();
    this.hook = new Button();
    this.melee = new Button();
    this.dive = new Button();
    this.recentre = new Button();
    this.pause = new Button();
    /** Direction of the last melee flick, screen-space radians. */
    this.meleeAngle = 0;
    /** 0..1 while the hook is being charged, for the reticle. */
    this.hookCharge = 0;
    /** Aim-hold state: while active, the right stick steers the throw. */
    this.hookAim = { active: false, x: 0, y: 0, mag: 0 };

    /** Which source produced the most recent input — used to swap the HUD. */
    this.lastSource = 'touch';

    this.isTouch = matchMedia('(hover: none) and (pointer: coarse)').matches
      || ('ontouchstart' in window && navigator.maxTouchPoints > 0);

    this._keys = Object.create(null);
    this._mouse = { down: false, dx: 0, dy: 0, locked: false };

    this._initTouch(dom);
    this._initKeyboard();
    this._initMouse(dom.canvas);
  }

  // ── touch ────────────────────────────────────────────────────────────────
  _initTouch(dom) {
    this.stickL = new Joystick(dom.zoneL, dom.knobL, dom.ringL, { floating: true });
    this.stickR = new Joystick(dom.zoneR, dom.knobR, dom.ringR, { floating: true });

    // LEFT — locomotion, plus the two verbs that aren't combat.
    this.stickL.onTap = () => { this.recentre.tap(); this.lastSource = 'touch'; };
    this.stickL.onFlick = (angle) => {
      // screen y is down, so a downward flick has a positive sine
      if (Math.sin(angle) > 0.55) { this.dive.tap(); this.lastSource = 'touch'; }
    };

    // RIGHT — camera, plus the combat verbs.
    this.stickR.onTap = () => { this.jump.tap(); this.lastSource = 'touch'; };
    this.stickR.onFlick = (angle) => {
      this.meleeAngle = angle;
      this.melee.tap();
      this.lastSource = 'touch';
    };
    this.stickR.onHoldRelease = () => { this.hook.tap(); this.lastSource = 'touch'; };

    this._park();
    addEventListener('resize', () => this._park());
    addEventListener('orientationchange', () => setTimeout(() => this._park(), 250));
  }

  /** Default resting spots, low in each half where a thumb naturally sits. */
  _park() {
    if (this.stickL.held || this.stickR.held) return;
    const y = innerHeight * (innerHeight < innerWidth ? 0.70 : 0.78);
    this.stickL.park(innerWidth * 0.20, y);
    this.stickR.park(innerWidth * 0.80, y);
  }

  // ── keyboard ─────────────────────────────────────────────────────────────
  _initKeyboard() {
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this._keys[e.code] = true;
      this.lastSource = 'kbm';
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    });
    addEventListener('keyup', (e) => { this._keys[e.code] = false; });
    addEventListener('blur', () => { this._keys = Object.create(null); });
  }

  // ── mouse ────────────────────────────────────────────────────────────────
  _initMouse(canvas) {
    canvas.addEventListener('mousedown', (e) => {
      if (this.isTouch) return;
      this.lastSource = 'kbm';
      if (e.button === 0) this._mouse.down = true;
      if (!this._mouse.locked && canvas.requestPointerLock) canvas.requestPointerLock();
    });
    addEventListener('mouseup', (e) => { if (e.button === 0) this._mouse.down = false; });
    addEventListener('mousemove', (e) => {
      if (this.isTouch || !this._mouse.locked) return;
      this._mouse.dx += e.movementX;
      this._mouse.dy += e.movementY;
      this.lastSource = 'kbm';
    });
    document.addEventListener('pointerlockchange', () => {
      this._mouse.locked = document.pointerLockElement === canvas;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ── gamepad ──────────────────────────────────────────────────────────────
  _pollGamepad() {
    if (!navigator.getGamepads) return null;
    let pads;
    try { pads = navigator.getGamepads(); } catch { return null; }
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  /** Call once per frame, before anything reads the intent. */
  sample(dt) {
    // Per-frame gesture resolution. A still hold produces no touchmove events,
    // so this cannot be event-driven — and poll() also hands back the swipe
    // pixels the camera should consume this frame.
    this.stickL.poll();
    const swipeDx = this.stickR.poll();

    let mx = 0, my = 0, lx = 0, ly = 0, dxPx = 0;
    let jump = false, hook = false, melee = false, dive = false, recentre = false, pause = false;

    // touch sticks — screen y is down, intent y is forward, hence the negation
    if (this.stickL.held) {
      mx += this.stickL.x; my += -this.stickL.y;
      if (this.stickL.mag > 0.05) this.lastSource = 'touch';
    }
    // The touch camera is SWIPE-based: it consumes movement pixels, not held
    // deflection — see Joystick.js for why that is what makes hold-to-aim
    // possible. poll() has already filtered out flicks, aims, and mutes.
    if (swipeDx !== 0) {
      dxPx += swipeDx;
      this.lastSource = 'touch';
    }
    this.hookCharge = this.stickR.holdCharge;
    this.hookAim.active = this.stickR.aimActive;
    this.hookAim.x = this.stickR.x;
    this.hookAim.y = this.stickR.y;
    this.hookAim.mag = this.stickR.mag;

    // keyboard
    const k = this._keys;
    if (k.KeyW || k.ArrowUp) my += 1;
    if (k.KeyS || k.ArrowDown) my -= 1;
    if (k.KeyA || k.ArrowLeft) mx -= 1;
    if (k.KeyD || k.ArrowRight) mx += 1;
    if (k.KeyQ) lx -= 1;
    if (k.KeyE) lx += 1;
    jump = jump || !!k.Space;
    dive = dive || !!k.KeyC;
    hook = hook || !!k.KeyF;
    melee = melee || !!k.KeyV;
    recentre = recentre || !!k.KeyR;
    pause = pause || !!k.Escape;

    // mouse look — the same swipe pixels as touch, scaled for a wrist
    if (this._mouse.locked) {
      dxPx += this._mouse.dx * 0.45;
    }
    this._mouse.dx = 0; this._mouse.dy = 0;
    melee = melee || this._mouse.down;   // click = melee, matching flick-right

    // gamepad
    const gp = this._pollGamepad();
    if (gp) {
      const dz = (v) => (Math.abs(v) < 0.18 ? 0 : (v - Math.sign(v) * 0.18) / 0.82);
      const gx = dz(gp.axes[0] || 0), gy = dz(gp.axes[1] || 0);
      const rx = dz(gp.axes[2] || 0);
      if (gx || gy || rx) this.lastSource = 'pad';
      mx += gx; my += -gy;
      lx += rx;                       // right stick Y unused, same as touch
      const btn = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
      if (btn(0)) { jump = true; this.lastSource = 'pad'; }
      if (btn(1)) dive = true;
      if (btn(2)) { melee = true; this.lastSource = 'pad'; }        // X
      if (btn(7) || btn(5)) { hook = true; this.lastSource = 'pad'; }
      if (btn(10)) recentre = true;   // L3
      if (btn(9)) pause = true;
    }

    // normalise: diagonals must not be faster than cardinals
    const mMag = Math.hypot(mx, my);
    if (mMag > 1) { mx /= mMag; my /= mMag; }
    const lMag = Math.hypot(lx, ly);
    if (lMag > 1) { lx /= lMag; ly /= lMag; }

    this.move.x = mx; this.move.y = my; this.move.mag = Math.min(mMag, 1);
    this.look.x = lx; this.look.y = ly; this.look.mag = Math.min(lMag, 1);
    this.look.dxPx = dxPx;

    this.jump.set(jump);
    this.hook.set(hook);
    this.melee.set(melee);
    this.dive.set(dive);
    this.recentre.set(recentre);
    this.pause.set(pause);

    this.jump.edge();
    this.hook.edge();
    this.melee.edge();
    this.dive.edge();
    this.recentre.edge();
    this.pause.edge();
  }
}
