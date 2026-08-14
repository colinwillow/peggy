// Peggy — the character controller.
//
// She is a pirate, a cyclops, and an octopus, and the movement has to say all
// three. Concretely that means:
//
//  * ON LAND she is heavy and lopsided. A peg leg is not a foot: the run has a
//    limp built into it (see the gait phase, which the model reads), she
//    accelerates like something with weight, and she does NOT turn on a dime.
//  * IN WATER she is the opposite — she is finally in her element, so swimming
//    is faster than running, turns instantly, and moves in full 3D. Falling in
//    the sea is meant to feel like an upgrade, not a failure state. That's the
//    reason there's no drowning timer and no fall damage into water.
//  * THE HOOK is her hand, so it drives traversal, not just combat. See Hook.js.
//
// Motion model, inherited from Robits and cleaned up: input is smoothed into an
// intent vector, the intent drives a TARGET velocity, and actual velocity eases
// toward that target — never input straight onto velocity. On top of that sits
// a momentum term that builds while you keep moving, so there's a felt
// walk -> jog -> run gather rather than a speed toggle.

import * as THREE from '../../vendor/three/three.module.js';
import { clamp, clamp01, damp, dampAngle, wrapAngle, lerp, smoothstep } from '../core/math.js';

export const State = {
  GROUND: 'ground',
  AIR: 'air',
  SWIM: 'swim',        // at the surface
  DIVE: 'dive',        // fully submerged
  GRAPPLE: 'grapple',  // being reeled toward an anchor
  SWING: 'swing',      // hanging from the rope
};

const TUNING = {
  radius: 0.42,
  height: 1.55,
  eyeHeight: 1.2,

  walkSpeed: 3.1,
  runSpeed: 6.5,
  momentumBuild: 0.55,    // per second toward full momentum
  momentumDecay: 1.6,
  momentumFloor: 0.62,    // cold start is a jog, not a standstill

  groundAccelHL: 0.10,    // half-life, seconds
  groundBrakeHL: 0.13,
  airAccelHL: 0.34,
  airControl: 0.55,       // fraction of ground authority while airborne

  turnHL: 0.055,          // land turning: deliberate, with a bit of lean
  swimTurnHL: 0.028,      // water turning: immediate

  gravity: 24.0,
  fallGravity: 36.0,      // heavier on the way down => snappy, non-floaty arc
  maxFall: 32.0,
  jumpSpeed: 8.6,
  coyoteTime: 0.12,       // grace after walking off a ledge
  jumpBuffer: 0.14,       // grace for pressing jump just before landing
  stepHeight: 0.52,       // ledges under this are stepped onto, not blocked
  snapDistance: 0.35,     // stick to the ground over small dips
  // How far past her centre the ground query looks. Half the collision radius:
  // enough that she bridges any gap narrower than her body — the seam between
  // two crates, a plank joint — and far short of the radius, so she is never
  // lifted onto a wall she is standing against. See Level.groundAt.
  groundProbe: 0.21,
  maxSlope: 0.62,         // cos of the steepest walkable angle (~52 degrees)
  slideAccel: 14.0,

  swimSpeed: 4.6,
  diveSpeed: 5.4,
  swimAccelHL: 0.16,
  buoyancy: 3.2,          // upward drift when submerged and not diving
  surfaceSnapHL: 0.09,    // how tightly the body tracks the wave surface
  waterEntrySpeed: 0.55,  // vertical velocity retained when you hit the water
  swimDepth: 0.62,        // how far below the surface her body floats

  // ── air jumps ───────────────────────────────────────────────────────────
  airJumps: 1,            // how many extra jumps she gets after leaving the ground
  airJumpSpeed: 8.2,      // slightly under the ground jump, so the first is king

  // ── melee: a three-hit combo ────────────────────────────────────────────
  // Flick, flick, flick: forehand, backhand, then a full spin. Each stage is
  // its own tuning row because the third hit has to feel like a finisher, not
  // a third copy of the first — longer, wider (a full circle), harder.
  meleeStages: [
    { time: 0.32, lunge: 4.2, range: 2.6, arc: 1.8,          power: 11 },
    { time: 0.30, lunge: 4.6, range: 2.7, arc: 2.0,          power: 12 },
    { time: 0.52, lunge: 5.6, range: 3.1, arc: Math.PI * 2,  power: 17 },
  ],
  comboWindow: 0.60,      // seconds after a swing ends to chain the next stage
  comboCooldown: 0.10,    // beat between chained swings
  finisherCooldown: 0.42, // longer recovery after the spin
};

export class Peggy {
  constructor(level, water) {
    this.level = level;
    this.water = water;
    this.T = TUNING;

    this.position = new THREE.Vector3(0, 0, 0);
    this.velocity = new THREE.Vector3();
    this.facing = 0;              // yaw, radians
    this.state = State.AIR;
    this.grounded = false;
    this.groundNormal = new THREE.Vector3(0, 1, 0);

    /** Smoothed intent, world space. Not the raw stick. */
    this.intent = new THREE.Vector2();
    this.momentum = 0;
    /** 0..1 planar speed as a fraction of run speed — the model animates off this. */
    this.speedRatio = 0;
    /** Advances with distance travelled, so the limp stays in step at any speed. */
    this.gaitPhase = 0;

    this.submerged = 0;           // 0 = dry, 1 = fully under
    this.airborneTime = 0;
    this.groundedTime = 0;
    this._coyote = 0;
    this._jumpBuffered = 0;
    this._landImpact = 0;         // vertical speed of the last landing, for squash
    // Blocks an immediate reverse water transition. Without it, entering the
    // water and leaving it both re-trigger on the very next step — the body has
    // not been integrated yet, so it is still exactly at the threshold — and
    // the state ping-pongs every frame.
    this._waterLock = 0;

    /** Counts down while a melee swing owns her. */
    this.meleeTimer = 0;
    /** Which combo stage the current/last swing was: 0 forehand, 1 backhand, 2 spin. */
    this.meleeStage = 0;
    /** Duration of the current swing — stages differ, so the model reads this. */
    this.meleeDuration = 0.32;
    this._meleeCd = 0;
    this._comboT = 0;
    this._meleeQueued = false;
    this._meleeS = null;
    this._airJumpsLeft = 1;

    /** Set by Hook.js while a grapple owns the movement. */
    this.hookOverride = null;

    this.events = [];             // drained by the audio/FX layer each frame

    this._ground = { y: 0, normal: new THREE.Vector3(0, 1, 0), solid: null };
    this._tmp = new THREE.Vector3();
  }

  emit(type, data) { this.events.push({ type, ...data }); }
  drainEvents() { const e = this.events; this.events = []; return e; }

  get eyePosition() {
    return this._tmp.set(this.position.x, this.position.y + this.T.eyeHeight, this.position.z);
  }

  /** Unit forward vector, from facing. */
  forward(out = new THREE.Vector3()) {
    return out.set(Math.sin(this.facing), 0, Math.cos(this.facing));
  }

  /**
   * @param {number} dt fixed timestep
   * @param {{x:number,y:number,mag:number}} move  screen-space stick
   * @param {object} buttons  { jump, dive } with .pressed / .down
   * @param {number} camYaw   camera yaw, for camera-relative movement
   *
   * There is deliberately no pitch parameter. The camera's tilt is fixed, so
   * nothing about movement — including swimming down — is allowed to depend on
   * where the camera is looking vertically.
   */
  update(dt, move, buttons, camYaw) {
    // Camera-relative: the stick means "that way on screen", always.
    //
    // Derivation, written out because getting a sign wrong here is invisible in
    // any test that only checks that she moved:
    //
    //   the camera sits at  focus + (sin yaw, cos yaw) * distance
    //   so (sin yaw, cos yaw) points FROM the focus TO the camera — backwards.
    //   forward  F = (-sin yaw, -cos yaw)
    //   right    R = ( cos yaw, -sin yaw)      [ F rotated -90 deg about +Y ]
    //   wish     = move.x * R  +  move.y * F
    //
    // Sanity check at yaw = 0: the camera is at +Z looking toward -Z, so
    // forward must be -Z and right must be +X. F = (0,-1), R = (1,0). Correct.
    const cos = Math.cos(camYaw), sin = Math.sin(camYaw);
    const wishX = move.x * cos - move.y * sin;
    const wishZ = -move.x * sin - move.y * cos;
    const wishMag = clamp01(Math.hypot(wishX, wishZ));

    this._waterLock = Math.max(0, this._waterLock - dt);
    this.meleeTimer = Math.max(0, this.meleeTimer - dt);
    this._meleeCd = Math.max(0, this._meleeCd - dt);
    this._comboT = Math.max(0, this._comboT - dt);
    this._updateWaterState();

    // Air jumps come back whenever anything re-anchors her to the world.
    if (this.grounded || this.inWater || this.hookOverride) {
      this._airJumpsLeft = this.T.airJumps;
    }

    // Melee is available from anywhere except a grapple — swinging the hook
    // mid-air is half the point of having it.
    if (buttons.melee && buttons.melee.pressed && !this.hookOverride) {
      if (this._meleeCd <= 0) this._startMelee(camYaw, buttons.meleeAngle);
      // Flicked during the current swing: queue it, so mashing chains the
      // combo instead of dropping every input that lands mid-animation.
      else if (this.meleeTimer > 0) this._meleeQueued = true;
    }
    if (this._meleeQueued && this._meleeCd <= 0 && !this.hookOverride) {
      this._meleeQueued = false;
      if (this._comboT > 0) this._startMelee(camYaw, buttons.meleeAngle);
    }

    if (this.hookOverride) {
      this.hookOverride(dt, wishX, wishZ, wishMag);
    } else {
      switch (this.state) {
        case State.SWIM: this._swim(dt, wishX, wishZ, wishMag, buttons); break;
        case State.DIVE: this._dive(dt, wishX, wishZ, wishMag, buttons); break;
        case State.AIR: this._air(dt, wishX, wishZ, wishMag, buttons); break;
        default: this._groundMove(dt, wishX, wishZ, wishMag, buttons); break;
      }
    }

    this._integrate(dt);
    this._updateGait(dt);
  }

  // ── water classification ────────────────────────────────────────────────
  // One place decides wet vs dry, so no two systems can disagree about whether
  // she's swimming.

  _updateWaterState() {
    const surf = this.water.heightAt(this.position.x, this.position.z);
    const chestY = this.position.y + this.T.height * 0.55;
    this.waterSurface = surf;
    this.submerged = clamp01((surf - this.position.y) / this.T.height);

    const inWater = this.state === State.SWIM || this.state === State.DIVE;
    if (this._waterLock > 0) return;

    if (!inWater && chestY < surf) {
      // Entered the water. Deep enough to swim, or is this a shallow beach?
      const ground = this.level.groundAt(this.position.x, this.position.z, Infinity, this._ground, this.T.groundProbe);
      if (surf - ground.y > this.T.height * 0.75) {
        const impact = -this.velocity.y;
        this.state = State.SWIM;
        this.velocity.y *= this.T.waterEntrySpeed;
        this.grounded = false;
        this._waterLock = 0.25;
        this.emit('splash', { speed: impact, y: surf });
      }
    } else if (inWater) {
      const ground = this.level.groundAt(this.position.x, this.position.z, Infinity, this._ground, this.T.groundProbe);
      // Wading out onto a beach: hand control back to the walk cycle.
      if (surf - ground.y < this.T.height * 0.55 && this.position.y <= ground.y + 0.3) {
        this.state = State.GROUND;
        this.emit('wadeOut', {});
      }
    }
  }

  // ── ground ──────────────────────────────────────────────────────────────

  _groundMove(dt, wishX, wishZ, wishMag, buttons) {
    const T = this.T;
    const g = this.level.groundAt(this.position.x, this.position.z, this.position.y + T.stepHeight, this._ground, T.groundProbe);
    this.groundNormal.copy(g.normal);

    const dropTo = g.y;
    const gap = this.position.y - dropTo;

    // Leaving the ground: only after the gap exceeds the snap distance, so
    // running down a bumpy slope doesn't launch her every few metres.
    if (gap > T.snapDistance && this.velocity.y <= 0.01) {
      this.state = State.AIR;
      this.grounded = false;
      this._coyote = T.coyoteTime;
      this._air(dt, wishX, wishZ, wishMag, buttons);
      return;
    }

    this.grounded = true;
    this.groundedTime += dt;
    this.airborneTime = 0;
    this._coyote = T.coyoteTime;
    this.position.y = dropTo;
    if (this.velocity.y < 0) this.velocity.y = 0;

    // Too steep to stand on: slide, and don't allow a jump off it.
    const steep = g.normal.y < T.maxSlope;
    if (steep) {
      const slideX = g.normal.x, slideZ = g.normal.z;
      const l = Math.hypot(slideX, slideZ) || 1;
      this.velocity.x += (slideX / l) * T.slideAccel * dt;
      this.velocity.z += (slideZ / l) * T.slideAccel * dt;
      this.state = State.GROUND;
      this._applyIntent(dt, wishX * 0.25, wishZ * 0.25, wishMag * 0.25, T.groundAccelHL, 1);
      return;
    }

    // Momentum: builds while you hold a direction, bleeds off when you stop.
    const moving = wishMag > 0.18;
    this.momentum = clamp01(this.momentum + (moving ? T.momentumBuild : -T.momentumDecay) * dt);
    const top = lerp(T.walkSpeed, T.runSpeed, smoothstep(this.momentum)) *
                lerp(T.momentumFloor, 1, this.momentum);

    this._applyIntent(dt, wishX, wishZ, wishMag, moving ? T.groundAccelHL : T.groundBrakeHL, top);
    this._faceMotion(dt, wishX, wishZ, wishMag, T.turnHL);

    // Jump — with both grace windows. Coyote time forgives pressing a frame
    // after the ledge; the buffer forgives pressing a frame before landing.
    if (buttons.jump.pressed) this._jumpBuffered = T.jumpBuffer;
    this._jumpBuffered = Math.max(0, this._jumpBuffered - dt);
    if (this._jumpBuffered > 0) {
      this._jumpBuffered = 0;
      this.velocity.y = T.jumpSpeed;
      this.position.y += 0.02;
      this.state = State.AIR;
      this.grounded = false;
      this._coyote = 0;
      this.groundedTime = 0;
      this.emit('jump', { speed: this.speedRatio });
    }
  }

  // ── air ─────────────────────────────────────────────────────────────────

  _air(dt, wishX, wishZ, wishMag, buttons) {
    const T = this.T;
    this.grounded = false;
    this.airborneTime += dt;
    this.groundedTime = 0;
    this._coyote = Math.max(0, this._coyote - dt);

    // Asymmetric gravity: float a touch at the apex, then fall hard. This is
    // the difference between a jump that feels responsive and one that feels
    // like the moon, and it costs one branch.
    const g = this.velocity.y > 0 ? T.gravity : T.fallGravity;
    this.velocity.y = Math.max(this.velocity.y - g * dt, -T.maxFall);

    // Late jump off a ledge you already left — and past that window, the
    // DOUBLE JUMP. No flip animation yet; the second jump just resets the arc.
    if (buttons.jump.pressed) this._jumpBuffered = T.jumpBuffer;
    this._jumpBuffered = Math.max(0, this._jumpBuffered - dt);
    if (this._jumpBuffered > 0) {
      if (this._coyote > 0) {
        this._jumpBuffered = 0;
        this._coyote = 0;
        this.velocity.y = T.jumpSpeed;
        this.emit('jump', { speed: this.speedRatio, coyote: true });
      } else if (this._airJumpsLeft > 0) {
        this._jumpBuffered = 0;
        this._airJumpsLeft--;
        this.velocity.y = T.airJumpSpeed;
        this.emit('jump', { speed: this.speedRatio, air: true });
      }
    }

    const top = lerp(T.walkSpeed, T.runSpeed, this.momentum);
    this._applyIntent(dt, wishX, wishZ, wishMag, T.airAccelHL, top, T.airControl);
    this._faceMotion(dt, wishX, wishZ, wishMag, T.turnHL * 1.6);

    // Land.
    const ground = this.level.groundAt(this.position.x, this.position.z, this.position.y + 0.1, this._ground, T.groundProbe);
    if (this.velocity.y <= 0 && this.position.y <= ground.y + 0.02) {
      this.position.y = ground.y;
      this._landImpact = -this.velocity.y;
      this.velocity.y = 0;
      this.grounded = true;
      this.state = State.GROUND;
      this.groundNormal.copy(ground.normal);
      this.emit('land', { impact: this._landImpact });
    }
  }

  // ── swimming ────────────────────────────────────────────────────────────

  _swim(dt, wishX, wishZ, wishMag, buttons) {
    const T = this.T;
    this.grounded = false;
    this.momentum = clamp01(this.momentum + (wishMag > 0.18 ? T.momentumBuild : -T.momentumDecay) * dt);

    // Ride the wave surface rather than sitting at a fixed Y. Cheap, and it's
    // most of what sells "this is a sea and not a blue floor".
    const target = this.waterSurface - T.swimDepth;
    this.position.y = damp(this.position.y, target, T.surfaceSnapHL, dt);
    this.velocity.y = 0;

    this._applyIntent(dt, wishX, wishZ, wishMag, T.swimAccelHL, T.swimSpeed);
    this._faceMotion(dt, wishX, wishZ, wishMag, T.swimTurnHL);

    // Down you go. She's an octopus — underwater is the good part.
    if (buttons.dive.pressed) {
      this.state = State.DIVE;
      this.velocity.y = -T.diveSpeed * 0.6;
      this._diveGrace = 0.35;
      this.emit('dive', {});
      return;
    }
    // A jump out of the water, for climbing onto a low ledge or a boat.
    if (buttons.jump.pressed) {
      this.state = State.AIR;
      this.velocity.y = T.jumpSpeed * 0.78;
      this._waterLock = 0.30;
      this.emit('breach', {});
    }
  }

  _dive(dt, wishX, wishZ, wishMag, buttons) {
    const T = this.T;
    this.grounded = false;

    this._diveGrace = Math.max(0, (this._diveGrace || 0) - dt);

    // Underwater is a plane plus an explicit up/down, NOT a camera-aimed dive.
    // With a fixed camera there is no pitch to aim with, and tying depth to a
    // camera the player cannot tilt would make sinking feel like a bug.
    // So: stick swims her horizontally, hold DIVE to sink, hold JUMP to rise,
    // and let go of everything to drift up.
    const targetX = wishX * T.diveSpeed;
    const targetZ = wishZ * T.diveSpeed;
    let targetY = 0;

    if (buttons.dive.down) targetY -= T.diveSpeed * 0.85;
    else if (buttons.jump.down) targetY += T.diveSpeed * 0.85;
    else targetY += T.buoyancy * 0.30;   // she floats; idle means surfacing

    this.velocity.x = damp(this.velocity.x, targetX, T.swimAccelHL, dt);
    this.velocity.z = damp(this.velocity.z, targetZ, T.swimAccelHL, dt);
    this.velocity.y = damp(this.velocity.y, targetY, T.swimAccelHL, dt);

    if (wishMag > 0.05 || Math.abs(this.velocity.y) > 0.4) {
      const heading = Math.atan2(this.velocity.x, this.velocity.z);
      this.facing = dampAngle(this.facing, heading, T.swimTurnHL, dt);
    }

    // Surfaced. Requires actually rising — on the first dive step the body has
    // not been integrated downward yet, so a position-only test is still true
    // and would bounce us straight back to the surface. The grace window covers
    // the same failure when a wave crest passes overhead.
    if (this.position.y + T.swimDepth >= this.waterSurface
        && this.velocity.y >= 0 && this._diveGrace <= 0) {
      this.state = State.SWIM;
      this.velocity.y = 0;
      this.emit('surface', {});
    }

    // Sea floor.
    const ground = this.level.groundAt(this.position.x, this.position.z, this.position.y + 0.1, this._ground, T.groundProbe);
    if (this.position.y < ground.y) {
      this.position.y = ground.y;
      if (this.velocity.y < 0) this.velocity.y = 0;
    }
  }

  // ── melee ───────────────────────────────────────────────────────────────

  /**
   * Swing the hook. Direction comes from the flick itself when there is one, so
   * flicking left swipes left — otherwise she swings where she's facing.
   */
  _startMelee(camYaw, flickAngle) {
    const T = this.T;
    // Chain while the window is open; the spin always ends the chain.
    this.meleeStage = (this._comboT > 0 && this.meleeStage < 2) ? this.meleeStage + 1 : 0;
    const S = T.meleeStages[this.meleeStage];
    this._meleeS = S;
    this.meleeDuration = S.time;
    this.meleeTimer = S.time;
    this._meleeCd = S.time + (this.meleeStage === 2 ? T.finisherCooldown : T.comboCooldown);
    this._comboT = this.meleeStage === 2 ? 0 : S.time + T.comboWindow;

    if (flickAngle != null) {
      // screen-space flick -> world. Same basis as movement: forward is
      // -(sin, cos) of the camera yaw, right is (cos, -sin).
      const sx = Math.cos(flickAngle), sy = -Math.sin(flickAngle); // screen y is down
      const c = Math.cos(camYaw), s = Math.sin(camYaw);
      const wx = sx * c - sy * s;
      const wz = -sx * s - sy * c;
      if (Math.hypot(wx, wz) > 0.01) this.facing = Math.atan2(wx, wz);
    }

    // Lunge, so a swipe closes distance instead of flailing on the spot.
    const f = this.forward(this._tmp);
    this.velocity.x += f.x * S.lunge;
    this.velocity.z += f.z * S.lunge;

    this.emit('melee', {
      x: this.position.x, z: this.position.z,
      y: this.position.y + this.T.height * 0.6,
      facing: this.facing,
      stage: this.meleeStage,
      range: S.range,
      arc: S.arc,
      power: S.power,
    });
  }

  /** True if a world point is inside the current swing's cone. */
  meleeHits(x, y, z) {
    if (this.meleeTimer <= 0 || !this._meleeS) return false;
    const S = this._meleeS;
    const dx = x - this.position.x, dz = z - this.position.z;
    const d = Math.hypot(dx, dz);
    if (d > S.range || d < 0.01) return false;
    if (Math.abs(y - this.position.y) > this.T.height * 1.4) return false;
    if (S.arc >= Math.PI * 2) return true;   // the spin hits all the way round
    const f = this.forward(this._tmp);
    const dot = (dx * f.x + dz * f.z) / d;
    return dot > Math.cos(S.arc * 0.5);
  }

  // ── shared movement helpers ─────────────────────────────────────────────

  _applyIntent(dt, wishX, wishZ, wishMag, accelHL, topSpeed, authority = 1) {
    // Smooth the INTENT, not the velocity. Smoothing velocity alone makes
    // direction changes mushy; smoothing intent keeps the turn crisp while the
    // speed still ramps.
    this.intent.x = damp(this.intent.x, wishX, accelHL * 0.6, dt);
    this.intent.y = damp(this.intent.y, wishZ, accelHL * 0.6, dt);

    const targetX = this.intent.x * topSpeed;
    const targetZ = this.intent.y * topSpeed;
    const hl = accelHL / clamp(authority, 0.05, 1);

    this.velocity.x = damp(this.velocity.x, targetX, hl, dt);
    this.velocity.z = damp(this.velocity.z, targetZ, hl, dt);

    // Coast to a stop rather than snapping, but do snap once it's a crawl so
    // she never drifts imperceptibly forever.
    if (wishMag < 0.05) {
      const sp = Math.hypot(this.velocity.x, this.velocity.z);
      if (sp < 0.12) { this.velocity.x = 0; this.velocity.z = 0; }
    }

    this.speedRatio = clamp01(Math.hypot(this.velocity.x, this.velocity.z) / this.T.runSpeed);
  }

  _faceMotion(dt, wishX, wishZ, wishMag, turnHL) {
    if (wishMag < 0.12) return;
    const heading = Math.atan2(wishX, wishZ);
    // Turn faster the further off-heading she is, so a 180 doesn't feel like
    // steering a ship, but small corrections stay smooth.
    const off = Math.abs(wrapAngle(heading - this.facing)) / Math.PI;
    this.facing = dampAngle(this.facing, heading, turnHL * lerp(1, 0.45, off), dt);
  }

  _integrate(dt) {
    const T = this.T;

    this.position.x += this.velocity.x * dt;
    this.position.y += this.velocity.y * dt;
    this.position.z += this.velocity.z * dt;

    // Walls. Low solids are passed through as steps while grounded and treated
    // as walls in the air — so you can walk up a stack of crates, but you can't
    // drift sideways through one mid-jump.
    const step = this.grounded && this.state === State.GROUND ? T.stepHeight : 0;
    this.level.resolveHorizontal(this.position, T.radius, T.height, step);

    // Never fall out of the world.
    if (this.position.y < this.level.abyss) {
      this.position.y = this.level.abyss;
      if (this.velocity.y < 0) this.velocity.y = 0;
    }
  }

  _updateGait(dt) {
    // Phase advances with DISTANCE, not time, so footfalls stay locked to the
    // ground at every speed and the limp doesn't skate.
    const planar = Math.hypot(this.velocity.x, this.velocity.z);
    this.gaitPhase = (this.gaitPhase + planar * dt * 0.62) % 1;
  }

  get inWater() { return this.state === State.SWIM || this.state === State.DIVE; }

  /** Drop her at a spot, clearing all momentum. */
  teleport(x, y, z) {
    this.position.set(x, y, z);
    this.velocity.set(0, 0, 0);
    this.intent.set(0, 0);
    this.momentum = 0;
    this.state = State.AIR;
    this.grounded = false;
  }
}

export { TUNING };
