// Third-person follow camera.
//
// The lessons that made Robits' camera work, kept:
//
//  * Smoothing is dt-correct (half-lives, not per-frame lerp factors). Constant
//    factors judder the moment frame times vary, and the artefact reads as the
//    character stuttering, so it gets blamed on the movement code.
//  * Yaw is eased along the SHORTEST path and the lag is CAPPED. Without the
//    cap, a long turn builds a backlog that visibly unwinds when you stop — it
//    looks like the camera keeps turning after you let go.
//  * While the look stick is active, yaw tracks near 1:1. Follow-lag during
//    manual look feels like fighting the camera.
//  * The character sits off-centre, ahead-of-centre in the direction of travel,
//    so you see where you're going instead of where you've been.
//
// New here, because this game has water: the camera knows when it's underwater
// and hands that fact to the renderer for fog and colour grading.

import * as THREE from '../../vendor/three/three.module.js';
import { clamp, damp, dampAngle, wrapAngle, lerp, clamp01, smoothstep } from '../core/math.js';

const CAM = {
  distance: 6.3,
  height: 1.55,
  lookHeight: 1.3,

  // FIXED TILT. The player rotates the camera around her but never tilts it.
  // That's the convention for this kind of third-person action game, and the
  // real payoff is that it frees the right stick's vertical axis — and with it
  // the whole right thumb — for melee / shoot / interact instead of spending it
  // on a pitch axis nobody asks for.
  pitch: 0.15,           // ~9 degrees — near-level, the world ahead not the ground

  yawRate: 2.9,          // radians/sec at full stick (gamepad / Q,E)
  swipeSens: 0.0075,     // radians per swiped pixel (touch / mouse)
  yawHL: 0.10,
  yawHLFree: 0.03,       // while the player is actively turning
  maxYawLag: 0.09,       // radians the camera may trail its target
  focusHL: 0.085,

  // Recentre, on demand. Deliberately NOT automatic: a camera that swings
  // itself behind you fights every deliberate angle you set, so instead the
  // player taps to snap it back when they want it.
  recentreHL: 0.11,      // fast enough to feel like a snap, slow enough to read

  // Twin-stick attract: while the right stick HOLDS a direction, the camera
  // keeps easing around behind it. Slower than a recentre on purpose — this is
  // "always adjusting", a follow, not a snap.
  attractHL: 0.30,

  lookAhead: 1.5,
  lookAheadHL: 0.35,

  // Twin-stick AIM mode: while the trigger is held the camera drops low and
  // near-level behind her, and the right stick becomes a conventional look
  // control — x turns, y tilts. The fixed-tilt rule above still holds for
  // free play; this is the one deliberate exception, and it lapses the frame
  // the trigger lifts.
  aimYawRate: 3.4,
  aimPitchRate: 1.7,
  aimPitchRest: 0.03,    // near-level: the world ahead, not the ground
  aimPitchMin: -0.55,    // how far up you may aim
  aimPitchMax: 0.42,     // ...and down
  aimBlendHL: 0.20,      // the two cameras trade places smoothly, not snappily
  aimDistanceK: 0.78,    // the boom pulls in a little
  aimHeightK: 0.55,      // ...and rides lower

  swimDistance: 6.2,
  diveDistance: 5.4,

  minDistance: 0.85,     // how close the boom may get when pinned against geometry
  collisionRadius: 0.42,
  collisionHL: 0.05,     // pull IN fast (else you see through the hill)...
  collisionOutHL: 0.42,  // ...and ease back OUT slowly

  fovBase: 62,
  fovSpeedBoost: 9,      // widens with speed, which is most of the sense of pace
  fovHL: 0.28,

  shakeDecay: 2.6,
};

export class FollowCamera {
  constructor(camera, level, water) {
    this.camera = camera;
    this.level = level;
    this.water = water;

    this.yaw = 0;
    this.targetYaw = 0;
    /** Fixed. Exposed so it can be tweaked live from the console. */
    this.pitch = CAM.pitch;
    /** Twin-stick aim mode: blend toward the low boom, and the aimed tilt. */
    this.aimBlend = 0;
    this.aimPitch = CAM.aimPitchRest;
    /** The tilt the camera is actually rendering with — fire along this. */
    this.pitchEff = CAM.pitch;
    this._aimHold = false;

    this.focus = new THREE.Vector3();
    this.distance = CAM.distance;
    this._distanceWanted = CAM.distance;
    this.trauma = 0;
    this.underwater = false;

    this._recentring = false;
    this._lookAhead = new THREE.Vector2();
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
  }

  /** Kick the camera without easing — for spawns and cuts. */
  snapTo(peggy) {
    this.targetYaw = this.yaw = peggy.facing + Math.PI;
    this.focus.set(peggy.position.x, peggy.position.y + CAM.lookHeight, peggy.position.z);
    this.distance = this._distanceWanted = CAM.distance;
    this._recentring = false;
  }

  /**
   * Swing the camera back behind her. Bound to a tap on the MOVE stick, so a
   * player who is only running around never has to touch the right thumb.
   */
  recentre(peggy) {
    this.targetYaw = peggy.facing + Math.PI;
    this._recentring = true;
  }

  addTrauma(t) { this.trauma = clamp01(this.trauma + t); }

  /**
   * Ask the camera to work its way around behind `yaw` (a facing; the camera
   * sits at facing + PI). One-frame request — call it every frame the pull
   * should hold, and it simply lapses when you stop.
   */
  attract(yaw) { this._attractYaw = yaw + Math.PI; }

  /**
   * Twin-stick aim. Call every frame the trigger is held: `x` turns at a
   * rate, `yUp` (stick up = positive) tilts the aim, `dyPx` is mouse pixels
   * for the kbm path. One-frame request like attract() — it lapses when the
   * calls stop, and the camera eases back to the fixed follow tilt.
   */
  aimLook(dt, x, yUp, dyPx = 0) {
    this._aimHold = true;
    this.targetYaw -= x * CAM.aimYawRate * dt;
    this.aimPitch = clamp(
      this.aimPitch - yUp * CAM.aimPitchRate * dt + dyPx * 0.0045,
      CAM.aimPitchMin, CAM.aimPitchMax
    );
    this._recentring = false;
  }

  update(dt, peggy, look) {
    // ── aim-mode blend ────────────────────────────────────────────────────
    this.aimBlend = damp(this.aimBlend, this._aimHold ? 1 : 0, CAM.aimBlendHL, dt);
    if (!this._aimHold) this.aimPitch = damp(this.aimPitch, CAM.aimPitchRest, 0.35, dt);
    this._aimHold = false;
    // ── twin-stick attract ────────────────────────────────────────────────
    // Runs before manual input so a deliberate swipe mid-hold still wins the
    // frame (it moves targetYaw after we do).
    if (this._attractYaw != null) {
      this.targetYaw = dampAngle(this.targetYaw, this._attractYaw, CAM.attractHL, dt);
      this._attractYaw = null;
      this._recentring = false;
    }
    // ── manual rotation ───────────────────────────────────────────────────
    // Two inputs: a rate from held sticks (gamepad, Q/E) and swiped pixels
    // from touch/mouse. Horizontal only; look.y is ignored — see CAM.pitch.
    const dxPx = look.dxPx || 0;
    const turning = Math.abs(look.x) > 0.05 || Math.abs(dxPx) > 0.5;
    if (turning) {
      this.targetYaw -= look.x * CAM.yawRate * dt + dxPx * CAM.swipeSens;
      this._recentring = false;    // any manual input cancels a recentre
    }

    // ── ease yaw, with the lag cap ────────────────────────────────────────
    // Without the cap a long turn builds a backlog that visibly unwinds after
    // you let go, which reads as the camera continuing to turn on its own.
    const hl = this._recentring ? CAM.recentreHL : (turning ? CAM.yawHLFree : CAM.yawHL);
    this.yaw = dampAngle(this.yaw, this.targetYaw, hl, dt);
    const lag = wrapAngle(this.targetYaw - this.yaw);
    if (this._recentring) {
      if (Math.abs(lag) < 0.02) { this.yaw = this.targetYaw; this._recentring = false; }
    } else {
      const maxLag = turning ? CAM.maxYawLag * 0.6 : CAM.maxYawLag;
      if (Math.abs(lag) > maxLag) this.yaw = this.targetYaw - Math.sign(lag) * maxLag;
    }

    // ── focus point, with look-ahead ──────────────────────────────────────
    const laX = peggy.velocity.x / Math.max(peggy.T.runSpeed, 0.001);
    const laZ = peggy.velocity.z / Math.max(peggy.T.runSpeed, 0.001);
    this._lookAhead.x = damp(this._lookAhead.x, laX * CAM.lookAhead, CAM.lookAheadHL, dt);
    this._lookAhead.y = damp(this._lookAhead.y, laZ * CAM.lookAhead, CAM.lookAheadHL, dt);

    const wantX = peggy.position.x + this._lookAhead.x;
    const wantY = peggy.position.y + CAM.lookHeight;
    const wantZ = peggy.position.z + this._lookAhead.y;

    this.focus.x = damp(this.focus.x, wantX, CAM.focusHL, dt);
    this.focus.y = damp(this.focus.y, wantY, CAM.focusHL * 1.5, dt);
    this.focus.z = damp(this.focus.z, wantZ, CAM.focusHL, dt);

    // ── distance ──────────────────────────────────────────────────────────
    let want = CAM.distance;
    if (peggy.state === 'swim') want = CAM.swimDistance;
    else if (peggy.state === 'dive') want = CAM.diveDistance;
    else if (peggy.state === 'swing') want = CAM.distance * 1.2;
    want *= lerp(1, CAM.aimDistanceK, this.aimBlend);
    this._distanceWanted = damp(this._distanceWanted, want, 0.4, dt);

    // ── place it ──────────────────────────────────────────────────────────
    // The rendered tilt blends from the fixed follow pitch to the aimed one.
    this.pitchEff = lerp(this.pitch, this.aimPitch, this.aimBlend);
    const cp = Math.cos(this.pitchEff), sp = Math.sin(this.pitchEff);
    const dir = this._tmp.set(
      Math.sin(this.yaw) * cp,
      sp,
      Math.cos(this.yaw) * cp
    );

    const desired = this._distanceWanted;
    const safe = this._collide(this.focus, dir, desired);
    // Snap in immediately when something is in the way; drift back out gently.
    const dHL = safe < this.distance ? CAM.collisionHL : CAM.collisionOutHL;
    this.distance = damp(this.distance, safe, dHL, dt);

    this.camera.position.set(
      this.focus.x + dir.x * this.distance,
      this.focus.y + dir.y * this.distance
        + CAM.height * (1 - sp * 0.5) * lerp(1, CAM.aimHeightK, this.aimBlend),
      this.focus.z + dir.z * this.distance
    );

    // Never let the lens go under the terrain — being inside a hill is the one
    // camera failure that makes a game unplayable rather than just ugly.
    const groundY = this.level.groundAt(this.camera.position.x, this.camera.position.z, Infinity, {}).y;
    if (this.camera.position.y < groundY + 0.5) this.camera.position.y = groundY + 0.5;

    // ── shake ─────────────────────────────────────────────────────────────
    if (this.trauma > 0) {
      const s = this.trauma * this.trauma; // quadratic: small hits stay subtle
      this.camera.position.x += (Math.random() - 0.5) * s * 0.7;
      this.camera.position.y += (Math.random() - 0.5) * s * 0.7;
      this.camera.position.z += (Math.random() - 0.5) * s * 0.7;
      this.trauma = Math.max(0, this.trauma - CAM.shakeDecay * dt * this.trauma);
      if (this.trauma < 0.001) this.trauma = 0;
    }

    this.camera.lookAt(this.focus);

    // ── fov ───────────────────────────────────────────────────────────────
    const targetFov = CAM.fovBase + peggy.speedRatio * CAM.fovSpeedBoost;
    this.camera.fov = damp(this.camera.fov, targetFov, CAM.fovHL, dt);
    this.camera.updateProjectionMatrix();

    // ── underwater flag, for the renderer ─────────────────────────────────
    const surf = this.water.heightAt(this.camera.position.x, this.camera.position.z);
    this.underwater = this.camera.position.y < surf;
  }

  /**
   * March along the boom from the focus point outward and stop at the first
   * thing we'd be inside. A handful of samples beats a proper sweep here: the
   * boom is short, the world is mostly convex hills, and this never tunnels.
   */
  _collide(focus, dir, desired) {
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      const d = (desired * i) / steps;
      const x = focus.x + dir.x * d;
      const z = focus.z + dir.z * d;
      const y = focus.y + dir.y * d;
      const g = this.level.groundAt(x, z, Infinity, this._ground || (this._ground = {}));
      if (y < g.y + CAM.collisionRadius) {
        // Floor it low rather than at a comfortable distance. Pressed into a
        // doorway there IS no comfortable distance, and a boom that refuses to
        // come closer than a metre just ends up inside the wall instead.
        return Math.max((desired * (i - 1)) / steps, CAM.minDistance);
      }
    }
    return desired;
  }
}

export { CAM };
