// Virtual thumbstick.
//
// Ported forward from Robits, which got this right after a lot of play-testing.
// The parts that are load-bearing and should not be "simplified" away:
//
//  * FLOATING mode. The stick's centre is wherever your thumb first lands
//    inside a big invisible zone, not a fixed circle you have to find. On a
//    phone you never look at your thumbs, so a fixed stick means constantly
//    re-finding it. Fixed mode is kept as an option because some people prefer
//    a stick that stays put, and it parks the knob where you last used it.
//
//  * FLICK PEAK LATCH. A fast flick can peak and return between two frames —
//    at 30fps that happens constantly — and a per-frame sample misses it
//    entirely, so the gesture "doesn't register". We latch the strongest
//    deflection seen since the consumer last read it, so a flick lands at any
//    frame rate.
//
//  * TAP vs PUSH. A short touch that never travels is a tap (jump), separate
//    from a push (move). Both live on the same thumb, which is how you fit
//    twin-stick + jump onto a screen with no buttons.
//
//  * Touch identifier tracking. Multi-touch is the whole point; without
//    matching identifiers the two sticks steal each other's fingers.

import { clamp01 } from '../core/math.js';

const TAP_MAX_MS = 220;      // longer than this is a hold, not a tap
const TAP_MAX_TRAVEL = 15;   // px — moved further than this, it was a push
const TAP_MAX_PUSH = 0.4;    // and it must never have deflected past this

// ── THE FOUR GESTURES ──────────────────────────────────────────────────────
// One thumb, four verbs, told apart by deflection over time. This is what lets
// the right stick carry camera + jump + melee + hook without a single button.
//
//   TAP      down, barely moved, up fast              -> jump
//   HOLD     down, stays near centre, up after a beat -> throw the hook
//   FLICK    snapped out FAST and far                 -> melee
//   PUSH     out and sustained                        -> steer the camera
//
// TAP and HOLD are the same motion separated only by duration; FLICK and PUSH
// are the same motion separated only by speed. Both splits are reliable because
// a human doing one is not close to the threshold of the other.
const HOLD_MIN_MS = 220;     // past a tap, and it must have stayed near centre
// Generous on purpose. A thumb resting on glass for half a second wanders more
// than you'd think, and at 0.30 (19px of a 64px stick) ordinary wobble was
// disqualifying the hold — so the hook simply never fired. This same value is
// the camera's deadzone, so anywhere inside it is guaranteed camera-neutral.
const HOLD_MAX_PUSH = 0.38;
// A flick is defined by SPEED, not by "got far within a time window".
//
// The window version fired on ordinary camera drags: it started its clock the
// moment the thumb passed 30% deflection, and getting from 30% to 60% inside
// 230ms is something a deliberate drag does easily. Push and flick became the
// same gesture.
//
// Radial speed separates them cleanly. A real flick covers most of the stick in
// 60-90ms, so ~10-15 units/sec. A deliberate camera drag is 2-4 units/sec. The
// threshold sits in the empty middle.
const FLICK_MAG = 0.55;      // how far out it must get
const FLICK_SPEED = 6.0;     // deflection units per second — the real test
const FLICK_RESET = 0.30;    // fall back inside this to re-arm the next flick
const FLICK_SNAP_MS = 260;   // a flick faster than the sample rate: caught on release
const FLICK_MUTE_MS = 260;   // camera ignores this stick briefly after a flick,
                             // so a melee swipe doesn't also whip the view
// ...and the camera does not START turning until the thumb has been pushed out
// for this long. Muting AFTER a flick fires is not enough on its own: the
// wind-up frames — thumb already past the deadzone, not yet fast enough to be
// recognised — leaked about 11 degrees of yaw into every melee. A flick is over
// long before this window elapses, so it now contributes exactly nothing, while
// a real drag pays a delay of five frames that the camera's own smoothing hides.
const CAM_SETTLE_MS = 95;

export class Joystick {
  /**
   * @param {HTMLElement} zone  the touch region (a big invisible half-screen in floating mode)
   * @param {HTMLElement} knob  the visible thumb dot
   * @param {HTMLElement} ring  the visible base ring
   */
  constructor(zone, knob, ring, opts = {}) {
    this.zone = zone;
    this.knob = knob;
    this.ring = ring;

    this.x = 0;              // -1..1, screen-space right
    this.y = 0;              // -1..1, screen-space down
    this.mag = 0;            // 0..1 deflection
    this.angle = 0;          // radians, screen space

    this.floating = opts.floating !== false;
    this.radius = opts.radius ?? 64;      // px of travel for full deflection
    this.deadzone = opts.deadzone ?? 8;   // px before any output at all

    this.touchId = null;
    this.centreX = 0;
    this.centreY = 0;

    /** Gesture callbacks, set by the consumer. See THE FOUR GESTURES above. */
    this.onTap = null;          // ()      quick press, no travel
    this.onHoldRelease = null;  // ()      held near centre, then let go
    this.onFlick = null;        // (angle) snapped out fast — fires mid-motion
    this.onPress = null;
    this.onRelease = null;

    /** 0..1 while a hold is charging, for UI. Zero at every other moment. */
    this.holdCharge = 0;
    /**
     * True once a CLEAN touch (no flick, no early drag) has rested long enough
     * to become the hook-aim hold. From then on, deflection AIMS instead of
     * turning the camera, and release throws. Cleared on lift.
     */
    this.aimActive = false;
    this._draggedEarly = false;
    this._flickedThisTouch = false;
    /** Last gesture recognised, for the on-screen readout: tap|hold|flick|drag */
    this.lastGesture = '';
    this._flicked = false;
    this._muteUntil = 0;
    this._lastFrac = 0;
    this._lastMoveT = 0;
    this._radialSpeed = 0;
    this._outSince = 0;

    this._tapStart = 0;
    this._tapTravelled = false;
    this._tapPeak = 0;
    this._peakMag = 0;
    this._peakAngle = 0;
    this._pressedCentre = false;

    /** Where the visible stick sits when nothing is touching it. */
    this.parkX = 0;
    this.parkY = 0;

    this._onStart = this._onStart.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onEnd = this._onEnd.bind(this);

    zone.addEventListener('touchstart', this._onStart, { passive: false });
    // move/end go on window so a thumb that slides outside the zone keeps steering
    window.addEventListener('touchmove', this._onMove, { passive: false });
    window.addEventListener('touchend', this._onEnd);
    window.addEventListener('touchcancel', this._onEnd);
  }

  get held() { return this.touchId !== null; }
  /**
   * True for a beat after a flick. The camera reads this and ignores the stick,
   * so a melee swipe doesn't also fling the view sideways — which is the whole
   * reason a flick and a camera drag can share one thumb.
   */
  get muted() { return performance.now() < this._muteUntil; }
  /**
   * True once the thumb has been held out past the deadzone long enough that
   * this is definitely a drag and not the wind-up of a flick. The camera gates
   * on this; see CAM_SETTLE_MS.
   */
  get steadyOut() {
    return this._outSince !== 0 && performance.now() - this._outSince >= CAM_SETTLE_MS;
  }
  /** The deflection past which the camera responds — matches the hold zone. */
  static get camDeadzone() { return HOLD_MAX_PUSH; }
  /** True while the touch that began this hold started on the knob itself. */
  get centreHeld() { return this.touchId !== null && this._pressedCentre; }

  /**
   * Read and clear the strongest deflection since the last call.
   * Returns null if nothing crossed `threshold`.
   */
  consumeFlick(threshold = 0.85) {
    if (this._peakMag < threshold) return null;
    const out = { mag: this._peakMag, angle: this._peakAngle };
    this._peakMag = 0;
    return out;
  }

  _onStart(e) {
    if (this.touchId !== null) return;
    e.preventDefault();
    const t = e.changedTouches[0];

    if (this.knob) {
      const kr = this.knob.getBoundingClientRect();
      this._pressedCentre = Math.hypot(
        t.clientX - (kr.left + kr.width / 2),
        t.clientY - (kr.top + kr.height / 2)
      ) < 36;
    }

    if (this.floating) {
      // Centre lands under the thumb, wherever that is.
      this.centreX = t.clientX;
      this.centreY = t.clientY;
    } else {
      const r = this.zone.getBoundingClientRect();
      this.centreX = r.left + r.width / 2;
      this.centreY = r.top + r.height / 2;
      this.radius = r.width * 0.4;
    }
    this._showAt(this.centreX, this.centreY, 1);

    this.touchId = t.identifier;
    this._tapStart = performance.now();
    this._lastMoveT = this._tapStart;
    this._lastFrac = 0;
    this._radialSpeed = 0;
    this._outSince = 0;
    this.aimActive = false;
    this._draggedEarly = false;
    this._flickedThisTouch = false;
    this._tapTravelled = false;
    this._tapPeak = 0;
    this._flicked = false;
    this.holdCharge = 0;
    if (this.onPress) this.onPress();
    this._apply(t.clientX, t.clientY);
  }

  _onMove(e) {
    if (this.touchId === null) return;
    for (const t of e.changedTouches) {
      if (t.identifier !== this.touchId) continue;
      e.preventDefault();
      const travel = Math.hypot(t.clientX - this.centreX, t.clientY - this.centreY);
      if (travel > TAP_MAX_TRAVEL) this._tapTravelled = true;
      const frac = travel / this.radius;
      if (frac > this._tapPeak) this._tapPeak = frac;
      this._apply(t.clientX, t.clientY);
      this._gesture(frac);
      break;
    }
  }

  _onEnd(e) {
    if (this.touchId === null) return;
    for (const t of e.changedTouches) {
      if (t.identifier !== this.touchId) continue;
      const held = performance.now() - this._tapStart;
      const stillNearCentre = !this._tapTravelled && this._tapPeak < TAP_MAX_PUSH;
      const wasTap = stillNearCentre && held < TAP_MAX_MS;
      // A hold is the same motion as a tap, just sustained — and crucially it
      // must never have been pushed out, or it was a camera drag that happened
      // to start slowly.
      const wasHold = this.aimActive && !this._flickedThisTouch;
      // A flick can be over before two touchmoves have landed, especially on a
      // slow frame — the speed test never gets a chance to see it. Catch that
      // on release: far out, and gone almost immediately.
      const wasSnapFlick = !this._flickedThisTouch && !wasTap && !wasHold
        && this._tapPeak >= FLICK_MAG && held < FLICK_SNAP_MS;

      this.touchId = null;
      this._pressedCentre = false;
      this.x = this.y = this.mag = 0;
      // Drop the flick latch on release, so a slow hold-then-lift (aiming)
      // can never be mistaken for a flick.
      this._peakMag = 0;

      if (this.floating) {
        // Park where it was last used. Snapping the knob back to the zone's
        // centre puts it halfway up the screen over the action buttons.
        this._showAt(this.centreX, this.centreY, 0.45);
      } else {
        this._resetKnob();
      }

      this.holdCharge = 0;
      this.aimActive = false;
      this.lastGesture = wasTap ? 'tap' : wasHold ? 'hold'
        : (this._flickedThisTouch || wasSnapFlick) ? 'flick' : 'drag';
      if (this.onRelease) this.onRelease();
      if (wasTap && this.onTap) this.onTap();
      else if (wasHold && this.onHoldRelease) this.onHoldRelease();
      else if (wasSnapFlick) this._fireFlick();
      break;
    }
  }

  _apply(px, py) {
    const dx = px - this.centreX;
    const dy = py - this.centreY;
    const dist = Math.hypot(dx, dy) || 0.0001;
    const ang = Math.atan2(dy, dx);
    const clamped = Math.min(dist, this.radius);

    if (this.knob) {
      this.knob.style.left = (this.centreX + Math.cos(ang) * clamped) + 'px';
      this.knob.style.top = (this.centreY + Math.sin(ang) * clamped) + 'px';
    }

    if (dist < this.deadzone) {
      this.x = this.y = this.mag = 0;
      return;
    }
    // Rescale past the deadzone so the first pixel of real travel maps to a
    // real (tiny) speed instead of stepping straight to ~15%.
    const n = clamp01((dist - this.deadzone) / (this.radius - this.deadzone));
    this.angle = ang;
    this.mag = n;
    this.x = Math.cos(ang) * n;
    this.y = Math.sin(ang) * n;

    if (n > this._peakMag) { this._peakMag = n; this._peakAngle = ang; }
  }

  /**
   * Runs on every move. Detects the flick, and tracks how long a low-deflection
   * hold has been charging.
   */
  _gesture(frac) {
    const now = performance.now();
    const dt = Math.max((now - this._lastMoveT) / 1000, 1 / 500);
    const inst = (frac - this._lastFrac) / dt;
    // Smoothed, so one jittery sample between two touchmoves can't fire a melee.
    this._radialSpeed = this._radialSpeed * 0.5 + inst * 0.5;
    this._lastFrac = frac;
    this._lastMoveT = now;

    // Re-arm whenever the thumb comes back near the middle, so you can flick
    // repeatedly without lifting — which is how melee has to feel.
    if (frac < FLICK_RESET) this._flicked = false;

    // Track how long it has been continuously out past the camera's deadzone.
    if (frac >= HOLD_MAX_PUSH) { if (!this._outSince) this._outSince = now; }
    else this._outSince = 0;

    // A touch that pushes out BEFORE aim mode began is a camera drag, and it
    // stays one for the rest of that touch — it can never turn into an aim, so
    // ending a drag by resting the thumb can never accidentally throw a hook.
    // Once aim IS active the same deflection means "steer the throw" instead.
    if (frac >= HOLD_MAX_PUSH && !this.aimActive) this._draggedEarly = true;

    if (!this._flicked && !this.aimActive
        && frac >= FLICK_MAG && this._radialSpeed >= FLICK_SPEED) {
      this._fireFlick();
    }
  }

  /**
   * Called once per frame by Input.sample (touchmove events alone can't do
   * this — a perfectly still hold generates none). Decides when a clean touch
   * becomes the aim-hold, and runs the charge meter.
   *
   * The clean-touch rule is what keeps combos alive: a flick marks the whole
   * touch, so mashing melee without lifting can never trip into aim mode and
   * eat the next swing.
   */
  pollAim() {
    if (!this.held || this._flickedThisTouch || this._draggedEarly) {
      this.holdCharge = 0;
      return;
    }
    const t = performance.now() - this._tapStart;
    if (!this.aimActive && t >= HOLD_MIN_MS) {
      this.aimActive = true;
      this.lastGesture = 'hold';
    }
    this.holdCharge = this.aimActive ? clamp01((t - HOLD_MIN_MS) / 380) : 0;
  }

  _fireFlick() {
    this._flicked = true;
    this._flickedThisTouch = true;
    this._muteUntil = performance.now() + FLICK_MUTE_MS;
    this._outSince = 0;         // a flick can never count as a settled drag
    this.holdCharge = 0;
    this.lastGesture = 'flick';
    if (this.onFlick) this.onFlick(this.angle);
  }

  _showAt(x, y, opacity) {
    if (this.ring) {
      const d = this.radius * 2;
      this.ring.style.width = d + 'px';
      this.ring.style.height = d + 'px';
      this.ring.style.left = x + 'px';
      this.ring.style.top = y + 'px';
      this.ring.style.opacity = String(opacity);
    }
    if (this.knob) {
      this.knob.style.left = x + 'px';
      this.knob.style.top = y + 'px';
      this.knob.style.opacity = String(Math.max(opacity, 0.5));
    }
  }

  _resetKnob() {
    if (this.knob) {
      this.knob.style.left = this.centreX + 'px';
      this.knob.style.top = this.centreY + 'px';
    }
    if (this.ring) this.ring.style.opacity = '0.35';
  }

  /**
   * Put the visible stick somewhere sensible before it's ever been touched.
   * Needed because the context prompt rides on the right stick — with no park
   * position the very first prompt would appear in the top-left corner.
   */
  park(x, y) {
    this.parkX = this.centreX = x;
    this.parkY = this.centreY = y;
    if (!this.held) this._showAt(x, y, 0.32);
  }

  dispose() {
    this.zone.removeEventListener('touchstart', this._onStart);
    window.removeEventListener('touchmove', this._onMove);
    window.removeEventListener('touchend', this._onEnd);
    window.removeEventListener('touchcancel', this._onEnd);
  }
}
