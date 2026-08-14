// The hook.
//
// Peggy's hook is her hand, so it has to do everything a hand does. One button,
// four verbs, disambiguated entirely by WHAT IT HITS — the player never chooses
// a mode:
//
//   fires at an anchor above her      -> SWING   (pendulum, release to launch)
//   fires at an anchor at her level   -> REEL    (yank herself to it)
//   fires at a loose object           -> HAUL    (yank the object to her)
//   fires at nothing                  -> WHIFF   (short throw, retracts)
//
// That's the whole reason the hook is a grappling hook attached to her arm by a
// rope rather than a separate item: one input, and the world decides the verb.
// On a touchscreen you cannot afford a mode selector, so the world has to.

import * as THREE from '../../vendor/three/three.module.js';
import { clamp, clamp01, damp, lerp, smoothstep } from '../core/math.js';
import { State } from './Peggy.js';

const HOOK = {
  range: 17.0,
  flySpeed: 46.0,        // how fast the hook head travels out
  retractSpeed: 34.0,
  reelSpeed: 15.0,       // how fast she is pulled to an anchor
  reelArriveDist: 1.5,
  haulSpeed: 13.0,       // how fast an object is pulled to her
  swingGravity: 22.0,
  swingDamping: 0.24,    // per second; low, so the arc keeps its energy
  swingReleaseBoost: 1.22,
  minRopeLength: 2.4,
  ropeClimbRate: 3.4,    // push forward on the stick to climb the rope
  aimAssistCone: 0.35,
  whiffDistance: 6.0,
};

export const HookState = {
  IDLE: 'idle',
  FLYING: 'flying',
  REELING: 'reeling',
  HAULING: 'hauling',
  SWINGING: 'swinging',
  RETRACTING: 'retracting',
};

export class Hook {
  constructor(peggy, level, camera) {
    this.peggy = peggy;
    this.level = level;
    this.camera = camera;

    this.state = HookState.IDLE;
    this.head = new THREE.Vector3();     // world position of the hook head
    this.anchor = null;                  // the grapple point we latched
    this.hauled = null;                  // the object we're reeling in
    this.ropeLength = 0;
    this.swingAngleVel = 0;

    this._dir = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this.events = [];
  }

  emit(type, data) { this.events.push({ type, ...data }); }
  drainEvents() { const e = this.events; this.events = []; return e; }

  get active() { return this.state !== HookState.IDLE; }
  /** Where the rope leaves her body — roughly the hook arm. */
  handPosition(out = new THREE.Vector3()) {
    const p = this.peggy.position;
    const f = this.peggy.forward(this._tmp);
    return out.set(
      p.x + f.x * 0.18 - f.z * 0.34,
      p.y + this.peggy.T.height * 0.62,
      p.z + f.z * 0.18 + f.x * 0.34
    );
  }

  /**
   * Aim direction: where the camera is looking, flattened toward the horizon a
   * little so a normal chase-cam angle throws the hook forward rather than into
   * the ground at her feet.
   */
  aimDirection(out = new THREE.Vector3()) {
    this.camera.getWorldDirection(out);
    out.y = clamp(out.y + 0.20, -0.85, 0.9);
    return out.normalize();
  }

  update(dt, buttons, move) {
    switch (this.state) {
      case HookState.IDLE: this._idle(buttons); break;
      case HookState.FLYING: this._flying(dt); break;
      case HookState.REELING: this._reeling(dt, buttons); break;
      case HookState.HAULING: this._hauling(dt); break;
      case HookState.SWINGING: this._swinging(dt, buttons, move); break;
      case HookState.RETRACTING: this._retracting(dt); break;
    }
  }

  _idle(buttons) {
    if (!buttons.hook.pressed) return;
    this.handPosition(this.head);
    this._dir.copy(this.aimDirection());
    this.state = HookState.FLYING;
    this._flightDist = 0;
    this.emit('fire', {});

    // Resolve the target NOW, not on impact, and then fly straight at it.
    //
    // Flying along the raw camera aim instead is what a naive version does, and
    // it misses: the hook leaves her HAND but the aim comes from the CAMERA, so
    // the two rays diverge and the head sails past a target that was
    // comfortably inside the assist cone. Retargeting the direction once the
    // verb is decided is both more reliable and what makes the generous cone
    // feel like aim assist rather than like the hook ignoring you.
    this.target = this.level.findGrapplePoint(
      this.head, this._dir, HOOK.range, HOOK.aimAssistCone
    );
    this.targetHaulable = this.target ? null : this._findHaulable(this.head, this._dir);

    const goal = this.target ? this.target.pos : this.targetHaulable?.position;
    if (goal) this._dir.subVectors(goal, this.head).normalize();
  }

  _findHaulable(from, dir) {
    let best = null, bestScore = Infinity;
    for (const h of this.level.haulables) {
      if (h.held) continue;
      const d = this._tmp.subVectors(h.position, from);
      const dist = d.length();
      if (dist > HOOK.range || dist < 0.5) continue;
      const dot = d.dot(dir) / dist;
      if (dot < HOOK.aimAssistCone) continue;
      const score = dist * (1.6 - dot);
      if (score < bestScore) { bestScore = score; best = h; }
    }
    return best;
  }

  _flying(dt) {
    const step = HOOK.flySpeed * dt;
    this.head.addScaledVector(this._dir, step);
    this._flightDist += step;

    if (this.target) {
      if (this.head.distanceTo(this.target.pos) < 1.2) {
        this.head.copy(this.target.pos);
        this.anchor = this.target;
        this._latch();
        return;
      }
    } else if (this.targetHaulable) {
      if (this.head.distanceTo(this.targetHaulable.position) < 1.2) {
        this.hauled = this.targetHaulable;
        this.hauled.held = true;
        this.state = HookState.HAULING;
        this.emit('haulStart', { object: this.hauled });
        return;
      }
    }

    if (this._flightDist > (this.target || this.targetHaulable ? HOOK.range : HOOK.whiffDistance)) {
      this.state = HookState.RETRACTING;
      this.emit('whiff', {});
    }
  }

  /**
   * The verb decision. Whether an anchor is a swing or a reel is decided by
   * geometry alone — is it meaningfully above her? — so the same rope, thrown
   * at the same bar from a run or from a standstill, does the useful thing.
   */
  _latch() {
    const p = this.peggy.position;
    const rise = this.anchor.pos.y - (p.y + this.peggy.T.height);
    const horiz = Math.hypot(this.anchor.pos.x - p.x, this.anchor.pos.z - p.z);
    const wantsSwing = this.anchor.kind === 'swing' || (rise > 1.2 && rise > horiz * 0.55);

    if (wantsSwing) {
      this.state = HookState.SWINGING;
      this.ropeLength = Math.max(this.peggy.position.distanceTo(this.anchor.pos), HOOK.minRopeLength);
      this.peggy.state = State.SWING;
      this.peggy.grounded = false;
      this.peggy.hookOverride = (d, wx, wz, wm) => this._swingPhysics(d, wx, wz, wm);
      this.emit('swingStart', { anchor: this.anchor });
    } else {
      this.state = HookState.REELING;
      this.peggy.state = State.GRAPPLE;
      this.peggy.grounded = false;
      this.peggy.hookOverride = (d) => this._reelPhysics(d);
      this.emit('reelStart', { anchor: this.anchor });
    }
  }

  // ── reel: pull her to the anchor ────────────────────────────────────────

  _reelPhysics(dt) {
    const p = this.peggy.position;
    const a = this.anchor.pos;
    this._tmp.set(a.x - p.x, a.y - p.y - this.peggy.T.height * 0.5, a.z - p.z);
    const dist = this._tmp.length();
    if (dist < 1e-4) return;
    this._tmp.multiplyScalar(1 / dist);

    // Ease in over the first stretch so it's a yank, not a teleport.
    const ramp = smoothstep(clamp01(1 - dist / HOOK.range) * 1.6 + 0.25);
    const speed = HOOK.reelSpeed * lerp(0.55, 1, ramp);
    this.peggy.velocity.copy(this._tmp).multiplyScalar(speed);

    // Face where you're going.
    this.peggy.facing = Math.atan2(this._tmp.x, this._tmp.z);
    this.peggy.speedRatio = 1;
  }

  _reeling(dt, buttons) {
    this.head.copy(this.anchor.pos);
    const dist = this.peggy.position.distanceTo(this.anchor.pos);

    // Arrived, or the player let go.
    if (dist < HOOK.reelArriveDist || buttons.hook.pressed) {
      this._release(dist < HOOK.reelArriveDist ? 0.35 : 0.8);
      this.emit('reelEnd', {});
    }
  }

  // ── haul: pull the object to her ────────────────────────────────────────

  _hauling(dt) {
    const h = this.hauled;
    const hand = this.handPosition(this._tmp);
    this._dir.subVectors(hand, h.position);
    const dist = this._dir.length();

    if (dist < 1.0) {
      h.held = false;
      h.onCaught?.(this.peggy);
      this.hauled = null;
      this.state = HookState.RETRACTING;
      this.emit('haulEnd', {});
      return;
    }
    this._dir.multiplyScalar(1 / dist);
    h.position.addScaledVector(this._dir, HOOK.haulSpeed * dt);
    // Keep it out of the ground on the way in.
    const g = this.level.groundAt(h.position.x, h.position.z, Infinity, {});
    if (h.position.y < g.y + 0.4) h.position.y = g.y + 0.4;
    this.head.copy(h.position);
  }

  // ── swing: the good one ─────────────────────────────────────────────────

  _swingPhysics(dt, wishX, wishZ, wishMag) {
    const p = this.peggy.position;
    const a = this.anchor.pos;
    const v = this.peggy.velocity;

    // Gravity acts as normal; the rope constraint is what makes it an arc.
    v.y -= HOOK.swingGravity * dt;

    // Steering: the stick adds tangential force, which is how a real swing is
    // pumped. It's not a direct velocity set — you're adding energy to a
    // pendulum, so timing matters and a good swing rewards rhythm.
    if (wishMag > 0.1) {
      v.x += wishX * 15.0 * dt;
      v.z += wishZ * 15.0 * dt;
    }

    p.addScaledVector(v, dt);

    // Rope constraint: clamp to the sphere of radius ropeLength around the
    // anchor, and strip the radial component of velocity so she doesn't
    // bounce on the rope.
    this._tmp.subVectors(p, a);
    const dist = this._tmp.length();
    if (dist > this.ropeLength) {
      this._tmp.multiplyScalar(1 / dist);
      p.copy(a).addScaledVector(this._tmp, this.ropeLength);
      const radial = v.dot(this._tmp);
      if (radial > 0) v.addScaledVector(this._tmp, -radial);
    }

    // A little drag, or she swings forever.
    const drag = Math.pow(1 - HOOK.swingDamping, dt);
    v.multiplyScalar(drag);

    // Face along the swing.
    if (Math.hypot(v.x, v.z) > 0.4) {
      this.peggy.facing = damp(this.peggy.facing, Math.atan2(v.x, v.z), 0.10, dt);
    }
    this.peggy.speedRatio = clamp01(v.length() / this.peggy.T.runSpeed);

    // Don't swing through the island.
    const g = this.level.groundAt(p.x, p.z, Infinity, {});
    if (p.y < g.y) { p.y = g.y; this._release(0); }
  }

  _swinging(dt, buttons, move) {
    this.head.copy(this.anchor.pos);

    // Climb the rope by pushing forward, drop down by pulling back. Shortening
    // the rope at the bottom of the arc is how you gain height — the same trick
    // as standing up on a playground swing, and it makes the mechanic have a
    // skill ceiling instead of being a fixed-length pendulum.
    if (move.mag > 0.4) {
      const along = move.y;
      this.ropeLength = clamp(
        this.ropeLength - along * HOOK.ropeClimbRate * dt,
        HOOK.minRopeLength,
        HOOK.range
      );
    }

    if (buttons.hook.pressed) {
      // Release with a boost, so a well-timed let-go at the bottom of the arc
      // throws you properly.
      this._release(HOOK.swingReleaseBoost);
      this.emit('swingRelease', {});
    }
  }

  _release(boost) {
    if (boost > 0) {
      this.peggy.velocity.multiplyScalar(boost);
      // Guarantee at least a little lift so a release never drops you straight
      // down onto the thing you were swinging over.
      if (this.peggy.velocity.y > -1) {
        this.peggy.velocity.y = Math.max(this.peggy.velocity.y, 2.4);
      }
    }
    this.peggy.hookOverride = null;
    this.peggy.state = State.AIR;
    this.anchor = null;
    this.state = HookState.RETRACTING;
  }

  _retracting(dt) {
    const hand = this.handPosition(this._tmp);
    this._dir.subVectors(hand, this.head);
    const dist = this._dir.length();
    if (dist < 0.35) {
      this.state = HookState.IDLE;
      this.target = null;
      this.targetHaulable = null;
      return;
    }
    this._dir.multiplyScalar(1 / dist);
    this.head.addScaledVector(this._dir, Math.min(HOOK.retractSpeed * dt, dist));
  }
}

export { HOOK };
