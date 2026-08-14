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
  height: 2.0,
  lookHeight: 1.15,
  minPitch: -0.95,
  maxPitch: 1.05,

  yawRate: 2.9,          // radians/sec at full stick
  pitchRate: 1.9,
  yawHL: 0.10,
  yawHLFree: 0.03,       // while the player is actively looking
  maxYawLag: 0.09,       // radians the camera may trail its target
  focusHL: 0.085,

  autoFollowDelay: 1.1,  // seconds of no look input before auto-follow kicks in
  autoFollowHL: 0.85,    // deliberately slow — a camera that yanks itself behind
                         // you is worse than one that never does
  lookAhead: 1.5,
  lookAheadHL: 0.35,

  swimDistance: 6.2,
  swimPitchBias: -0.12,
  diveDistance: 5.4,

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
    this.pitch = 0.22;
    this.targetYaw = 0;
    this.targetPitch = 0.22;

    this.focus = new THREE.Vector3();
    this.distance = CAM.distance;
    this._distanceWanted = CAM.distance;
    this.trauma = 0;
    this.underwater = false;

    this._sinceLook = 99;
    this._lookAhead = new THREE.Vector2();
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
  }

  /**
   * Where the camera is LOOKING, positive = up.
   *
   * `pitch` is the orbit angle: positive puts the camera above the character,
   * which means it is looking DOWN. Every consumer wants the look direction,
   * not the orbit angle, so the flip lives here once instead of being
   * rediscovered (and got wrong) at each call site.
   */
  get aimPitch() { return -this.pitch; }

  /** Kick the camera without easing — for spawns and cuts. */
  snapTo(peggy) {
    this.targetYaw = this.yaw = peggy.facing + Math.PI;
    this.focus.set(peggy.position.x, peggy.position.y + CAM.lookHeight, peggy.position.z);
    this.distance = this._distanceWanted = CAM.distance;
  }

  addTrauma(t) { this.trauma = clamp01(this.trauma + t); }

  update(dt, peggy, look) {
    // ── manual look ───────────────────────────────────────────────────────
    const looking = look.mag > 0.05;
    if (looking) {
      this.targetYaw -= look.x * CAM.yawRate * dt;
      this.targetPitch = clamp(
        this.targetPitch + look.y * CAM.pitchRate * dt,
        CAM.minPitch, CAM.maxPitch
      );
      this._sinceLook = 0;
    } else {
      this._sinceLook += dt;
    }

    // ── auto-follow ───────────────────────────────────────────────────────
    // Only once the player has stopped steering, only while actually moving,
    // and slowly. This exists so you don't have to fight the stick to keep
    // running forward — not to take the camera away from you.
    const moving = peggy.speedRatio > 0.25 && !peggy.inWater;
    if (!looking && this._sinceLook > CAM.autoFollowDelay && moving) {
      const behind = peggy.facing + Math.PI;
      const blend = clamp01((this._sinceLook - CAM.autoFollowDelay) * 0.7) * peggy.speedRatio;
      this.targetYaw = this.targetYaw + wrapAngle(behind - this.targetYaw) *
        (1 - Math.pow(2, -dt / (CAM.autoFollowHL / Math.max(blend, 0.05))));
    }

    // ── ease yaw, with the lag cap ────────────────────────────────────────
    const hl = looking ? CAM.yawHLFree : CAM.yawHL;
    this.yaw = dampAngle(this.yaw, this.targetYaw, hl, dt);
    const lag = wrapAngle(this.targetYaw - this.yaw);
    const maxLag = looking ? CAM.maxYawLag * 0.6 : CAM.maxYawLag;
    if (Math.abs(lag) > maxLag) this.yaw = this.targetYaw - Math.sign(lag) * maxLag;

    let pitchTarget = this.targetPitch;
    if (peggy.state === 'swim') pitchTarget += CAM.swimPitchBias;
    this.pitch = damp(this.pitch, pitchTarget, 0.09, dt);

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
    this._distanceWanted = damp(this._distanceWanted, want, 0.4, dt);

    // ── place it ──────────────────────────────────────────────────────────
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
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
      this.focus.y + dir.y * this.distance + CAM.height * (1 - sp * 0.5),
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
        return Math.max((desired * (i - 1)) / steps, 1.2);
      }
    }
    return desired;
  }
}

export { CAM };
