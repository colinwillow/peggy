// Peggy, as geometry.
//
// This is a PLACEHOLDER, and it is deliberately a good one. Locomotion cannot
// be tuned against a capsule — you can't tell whether a run feels heavy without
// something with weight in it to watch — so the proxy carries the three things
// that define her silhouette: the one eye, the hook arm, and the peg leg. It is
// built from primitives so it costs nothing and can't block on an art delivery.
//
// The animation here is fully procedural, driven off the controller's state.
// The important one is the LIMP: the gait phase drives an asymmetric bob, heavy
// on the peg side, which is the single read that says "this character has a peg
// leg" before you have looked at her feet.
//
// SWAPPING IN THE REAL MODEL: drop a rigged peggy.glb into models/ and the
// loader below picks it up. Everything downstream talks to the interface at the
// bottom of this file (position / facing / update), so nothing else changes.
// Clip names it looks for are listed in CLIPS.

import * as THREE from '../../vendor/three/three.module.js';
import { GLTFLoader } from '../../vendor/three/addons/loaders/GLTFLoader.js';
import { toonMaterial, addOutline, makeGradientMap } from '../render/toon.js';
import { clamp, clamp01, damp, lerp, smoothstep, TAU } from '../core/math.js';

// Sampled off the character sheet.
export const PALETTE = {
  skin: 0xef8ab0,
  skinDark: 0xd85f92,
  blotch: 0xc9447f,
  mouth: 0x8e2f52,
  tongue: 0xe07a9a,
  tooth: 0xf5e6bc,
  tentacle: 0x9a55bd,
  tentacleDark: 0x7a3d99,
  coat: 0x43907c,
  coatDark: 0x2f6b5c,
  hat: 0x4b4468,
  hatBand: 0x39334f,
  bone: 0xf0e6cf,
  gold: 0xd8a63c,
  leather: 0x6b4a2f,
  leatherDark: 0x4a321f,
  metal: 0x9aa3ad,
  bandana: 0xd8403a,
  eyeWhite: 0xfdfaf2,
  iris: 0x8bb84a,
  pupil: 0x1a1420,
};

const CLIPS = {
  idle: ['idle', 'Idle', 'peggy_idle'],
  walk: ['walk', 'Walk', 'peggy_walk'],
  run: ['run', 'Run', 'peggy_run'],
  jump: ['running_jump', 'jump', 'Jump', 'peggy_jump'],
  fall: ['in_air', 'fall', 'Fall', 'peggy_fall'],
  land: ['landing', 'land', 'Land', 'peggy_land'],
  swim: ['swim', 'Swim', 'peggy_swim'],
  dive: ['dive', 'Dive', 'peggy_dive'],
  hook: ['hook', 'Hook', 'peggy_hook'],
  swing: ['swing', 'Swing', 'peggy_swing'],
  strafeL: ['left_strafe'],
  strafeR: ['right_strafe'],
  back: ['run_backward'],
};

// ── helpers ────────────────────────────────────────────────────────────────

function mat(color, opts = {}) {
  return toonMaterial({ color, ...opts });
}

function mesh(geo, material, parent, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = false;
  if (parent) parent.add(m);
  return m;
}

// ── the proxy ──────────────────────────────────────────────────────────────

export class ProxyPeggyModel {
  constructor() {
    this.root = new THREE.Group();
    this.root.name = 'peggy-proxy';
    this.isProxy = true;

    const skinMat = mat(PALETTE.skin);
    const skinDarkMat = mat(PALETTE.skinDark);
    const tentacleMat = mat(PALETTE.tentacle);
    const coatMat = mat(PALETTE.coat);
    const hatMat = mat(PALETTE.hat);
    const goldMat = mat(PALETTE.gold);
    const leatherMat = mat(PALETTE.leather);
    const metalMat = mat(PALETTE.metal, { rimStrength: 0.9, rimColor: 0xffffff });
    const boneMat = mat(PALETTE.bone);

    // ── body: a heavy pear. Wide at the mouth, narrow at the feet, which is
    //    what makes her read as top-heavy and lumbering rather than athletic.
    this.body = new THREE.Group();
    this.body.position.y = 0.72;
    this.root.add(this.body);

    const torsoGeo = new THREE.SphereGeometry(0.52, 20, 16);
    torsoGeo.scale(1.0, 1.08, 0.88);
    this.torso = mesh(torsoGeo, skinMat, this.body, 0, 0, 0);

    // The coat, hanging OPEN over the front. The phi sweep is the whole point:
    // a full 360° shell is a bigger sphere than the torso, so it swallows her —
    // no pink, no mouth, no character, just a teal egg in a hat. Leaving a wedge
    // out of the front is what lets the body read.
    // (phi = PI/2 is +Z, i.e. straight ahead, so the gap is centred there.)
    // thetaStart matters as much as the gap: starting at the pole domes the
    // coat over the top of her head and the whole thing reads as a fishbowl.
    // Start it at the shoulder line so the hat, eye and mouth are all clear of it.
    const COAT_GAP = 1.95; // radians of opening across the chest
    const coatGeo = new THREE.SphereGeometry(
      0.56, 20, 14,
      Math.PI / 2 + COAT_GAP / 2, TAU - COAT_GAP,
      Math.PI * 0.34, Math.PI * 0.44
    );
    coatGeo.scale(1.05, 1.30, 0.98);
    const coat = mesh(coatGeo, coatMat, this.body, 0, 0.05, -0.02);
    coat.material.side = THREE.DoubleSide;  // it's an open shell — you see inside it

    // ragged coat hem
    const hemGeo = new THREE.ConeGeometry(0.60, 0.42, 12, 1, true);
    const hem = mesh(hemGeo, coatMat, this.body, 0, -0.42, 0);
    hem.rotation.x = Math.PI;

    // belt + buckle
    const beltGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.16, 18);
    beltGeo.scale(1.0, 1, 0.9);
    mesh(beltGeo, leatherMat, this.body, 0, -0.22, 0);
    const buckleGeo = new THREE.BoxGeometry(0.20, 0.18, 0.06);
    mesh(buckleGeo, goldMat, this.body, 0, -0.22, 0.50);

    // ── the mouth: enormous, and the main thing you see from the front
    this.mouth = new THREE.Group();
    this.mouth.position.set(0, 0.02, 0.35);
    this.body.add(this.mouth);

    const mouthGeo = new THREE.SphereGeometry(0.34, 16, 12);
    mouthGeo.scale(1.05, 0.92, 0.55);
    mesh(mouthGeo, mat(PALETTE.mouth), this.mouth, 0, 0, 0.06);

    const tongueGeo = new THREE.SphereGeometry(0.20, 12, 10);
    tongueGeo.scale(1.0, 0.42, 0.9);
    mesh(tongueGeo, mat(PALETTE.tongue), this.mouth, 0, -0.13, 0.10);

    // a few uneven teeth — evenness would read as a cartoon smile, not a pirate
    const toothGeo = new THREE.BoxGeometry(0.085, 0.15, 0.06);
    mesh(toothGeo, boneMat, this.mouth, -0.16, 0.14, 0.20).rotation.z = 0.16;
    mesh(toothGeo, boneMat, this.mouth, 0.10, 0.16, 0.21).rotation.z = -0.09;
    const lowTooth = new THREE.BoxGeometry(0.08, 0.12, 0.06);
    mesh(lowTooth, boneMat, this.mouth, 0.19, -0.13, 0.19).rotation.z = 0.20;

    // lip, to separate mouth from face
    const lipGeo = new THREE.TorusGeometry(0.33, 0.055, 8, 20);
    lipGeo.scale(1.05, 0.94, 1.0);
    mesh(lipGeo, skinDarkMat, this.mouth, 0, 0, 0.09);

    // ── the eye. One. Big. It carries every bit of her expression.
    this.eyeGroup = new THREE.Group();
    this.eyeGroup.position.set(0, 0.40, 0.24);
    this.body.add(this.eyeGroup);

    this.eyeball = mesh(new THREE.SphereGeometry(0.235, 20, 18), mat(PALETTE.eyeWhite), this.eyeGroup);
    this.iris = mesh(new THREE.SphereGeometry(0.112, 16, 14), mat(PALETTE.iris), this.eyeGroup, 0, 0, 0.172);
    mesh(new THREE.SphereGeometry(0.058, 12, 10), mat(PALETTE.pupil), this.iris, 0, 0, 0.070);

    // eyelid — a cap that rotates down to blink
    this.lid = mesh(
      new THREE.SphereGeometry(0.246, 20, 12, 0, TAU, 0, Math.PI * 0.5),
      skinMat, this.eyeGroup
    );
    this.lid.rotation.x = -0.55;

    // brow, for the scowl
    this.brow = mesh(new THREE.BoxGeometry(0.42, 0.065, 0.11), skinDarkMat, this.eyeGroup, 0, 0.24, 0.12);
    this.brow.rotation.x = 0.25;

    // ── hat: tricorn, worn low over the eye
    this.hat = new THREE.Group();
    this.hat.position.set(0, 0.66, -0.02);
    this.body.add(this.hat);

    const crownGeo = new THREE.CylinderGeometry(0.24, 0.31, 0.30, 14);
    mesh(crownGeo, hatMat, this.hat, 0, 0.12, 0);
    // brim: a wide flattened cone, tipped up at the sides to fake the tricorn fold
    const brimGeo = new THREE.CylinderGeometry(0.56, 0.50, 0.07, 16);
    brimGeo.scale(1.0, 1, 0.82);
    const brim = mesh(brimGeo, hatMat, this.hat, 0, -0.02, 0);
    brim.rotation.z = 0.05;
    // gold trim
    const trimGeo = new THREE.TorusGeometry(0.53, 0.028, 6, 20);
    const trim = mesh(trimGeo, goldMat, this.hat, 0, -0.01, 0);
    trim.rotation.x = Math.PI / 2;
    trim.scale.set(1, 0.82, 1);

    // skull and crossbones
    const skull = mesh(new THREE.SphereGeometry(0.085, 12, 10), boneMat, this.hat, 0, 0.16, 0.26);
    skull.scale.set(1, 0.95, 0.7);
    mesh(new THREE.BoxGeometry(0.026, 0.030, 0.02), mat(PALETTE.pupil), skull, -0.032, 0.012, 0.075);
    mesh(new THREE.BoxGeometry(0.026, 0.030, 0.02), mat(PALETTE.pupil), skull, 0.032, 0.012, 0.075);
    const boneGeo = new THREE.CapsuleGeometry(0.016, 0.12, 4, 6);
    const b1 = mesh(boneGeo, boneMat, this.hat, 0, 0.075, 0.27); b1.rotation.z = Math.PI / 2 + 0.32;
    const b2 = mesh(boneGeo, boneMat, this.hat, 0, 0.075, 0.27); b2.rotation.z = Math.PI / 2 - 0.32;

    // bandana knot + tails at the back
    const bandGeo = new THREE.TorusGeometry(0.30, 0.055, 8, 16);
    const band = mesh(bandGeo, mat(PALETTE.bandana), this.body, 0, 0.46, 0);
    band.rotation.x = Math.PI / 2;
    this.bandanaTails = [];
    for (let i = 0; i < 2; i++) {
      const t = mesh(new THREE.ConeGeometry(0.055, 0.34, 6), mat(PALETTE.bandana), this.body,
        -0.06 + i * 0.12, 0.46, -0.30);
      t.rotation.x = -0.9 + i * 0.12;
      this.bandanaTails.push(t);
    }

    // ── hook arm (her right, screen left)
    this.hookArm = new THREE.Group();
    // Pivots sit OUTSIDE the torso's widest point (0.52 radius, up at the
    // shoulder line) — inside it, every swing frame put the arm through the
    // belly and it visibly poked out of her lower half while running.
    // Fully outside the torso: 0.52 surface + 0.13 arm radius, with margin.
    this.hookArm.position.set(-0.64, 0.22, 0.02);
    this.body.add(this.hookArm);
    const upperGeo = new THREE.CapsuleGeometry(0.135, 0.30, 5, 10);
    mesh(upperGeo, tentacleMat, this.hookArm, 0, -0.18, 0).rotation.z = 0.22;
    // brass cuff where the hook is strapped on
    const cuffGeo = new THREE.CylinderGeometry(0.115, 0.10, 0.14, 12);
    mesh(cuffGeo, goldMat, this.hookArm, -0.03, -0.36, 0);
    // the hook itself — an open torus arc
    this.hook = new THREE.Group();
    this.hook.position.set(-0.04, -0.46, 0);
    this.hookArm.add(this.hook);
    this.hook.scale.setScalar(1.25);   // the hook is her whole deal — oversell it
    const hookGeo = new THREE.TorusGeometry(0.135, 0.032, 8, 18, Math.PI * 1.35);
    const hookMesh = mesh(hookGeo, metalMat, this.hook, 0, -0.10, 0);
    hookMesh.rotation.set(Math.PI / 2, 0, -0.5);
    mesh(new THREE.ConeGeometry(0.034, 0.10, 8), metalMat, this.hook, 0.13, -0.02, 0).rotation.z = -0.6;

    // ── tentacle arm (her left, screen right)
    this.tentacleArm = new THREE.Group();
    this.tentacleArm.position.set(0.64, 0.22, 0.02);
    this.body.add(this.tentacleArm);
    this.tentacleSegments = [];
    let parent = this.tentacleArm;
    for (let i = 0; i < 5; i++) {
      const r = 0.125 - i * 0.019;
      const seg = mesh(
        new THREE.CapsuleGeometry(r, 0.11, 4, 8),
        i > 2 ? mat(PALETTE.tentacleDark) : tentacleMat,
        parent, 0, i === 0 ? -0.16 : -0.17, 0
      );
      this.tentacleSegments.push(seg);
      parent = seg;
    }
    // suckers, because at this size they're the read
    for (let i = 1; i < 5; i++) {
      const s = mesh(new THREE.SphereGeometry(0.028, 8, 6), mat(PALETTE.skin),
        this.tentacleSegments[i], 0.055, 0.02, 0.055);
      s.scale.set(1, 0.5, 1);
    }

    // ── the cutlass, curled in the tentacle's tip ─────────────────────────
    // She's a pirate: hook on one side, sword on the other. The blade is a
    // flattened torus arc — the classic cutlass sweep in one primitive.
    this.cutlass = new THREE.Group();
    const tip = this.tentacleSegments[this.tentacleSegments.length - 1];
    this.cutlass.position.set(0, -0.14, 0.04);
    this.cutlass.rotation.set(0.5, 0, -0.4);
    tip.add(this.cutlass);
    const bladeGeo = new THREE.TorusGeometry(0.38, 0.045, 6, 14, 1.9);
    bladeGeo.scale(1, 1, 0.28);
    const blade = mesh(bladeGeo, metalMat, this.cutlass, 0.10, 0.34, 0);
    blade.rotation.z = -0.5;
    mesh(new THREE.ConeGeometry(0.045, 0.16, 6), metalMat, this.cutlass, 0.40, 0.62, 0)
      .rotation.z = -1.1;
    // guard + grip
    const guard = mesh(new THREE.SphereGeometry(0.085, 10, 8, 0, TAU, 0, Math.PI * 0.6), goldMat, this.cutlass, 0, 0.06, 0);
    guard.rotation.x = Math.PI;
    mesh(new THREE.CylinderGeometry(0.032, 0.038, 0.16, 8), mat(PALETTE.leatherDark), this.cutlass, 0, -0.02, 0);

    // ── legs: one real, one peg. The asymmetry is the character.
    this.legL = new THREE.Group();          // her good leg
    this.legL.position.set(0.21, -0.42, 0);
    this.body.add(this.legL);
    mesh(new THREE.CapsuleGeometry(0.145, 0.20, 5, 10), tentacleMat, this.legL, 0, -0.14, 0);
    const footGeo = new THREE.SphereGeometry(0.17, 12, 10);
    footGeo.scale(1, 0.6, 1.35);
    mesh(footGeo, tentacleMat, this.legL, 0, -0.29, 0.06);

    this.legPeg = new THREE.Group();        // the peg
    this.legPeg.position.set(-0.20, -0.42, 0);
    this.body.add(this.legPeg);
    mesh(new THREE.CapsuleGeometry(0.14, 0.10, 5, 10), tentacleMat, this.legPeg, 0, -0.08, 0);
    // brass collar where flesh meets wood
    mesh(new THREE.CylinderGeometry(0.125, 0.115, 0.09, 12), goldMat, this.legPeg, 0, -0.19, 0);
    mesh(new THREE.ConeGeometry(0.105, 0.34, 10), mat(PALETTE.leather), this.legPeg, 0, -0.38, 0);
    mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.05, 8), mat(PALETTE.leatherDark), this.legPeg, 0, -0.55, 0);

    // ── the pink blotches off the character sheet ─────────────────────────
    // Flattened darker-pink spheres over the back and sides — the mottled skin
    // is half of what makes her read as a sea creature rather than a balloon.
    const blotchMat = mat(PALETTE.blotch);
    for (const [bx, by, bz, br] of [
      [-0.30, 0.20, -0.34, 0.15], [0.34, 0.02, -0.32, 0.12],
      [-0.16, -0.26, -0.40, 0.10], [0.24, 0.34, -0.26, 0.09],
      [-0.42, -0.02, -0.22, 0.08], [0.44, 0.22, -0.14, 0.07],
    ]) {
      const b = mesh(new THREE.SphereGeometry(br, 8, 6), blotchMat, this.body, bx, by, bz);
      b.lookAt(bx * 3, 0.72 + by * 3, bz * 3);   // face outward from the body
      b.scale.z = 0.30;                          // ...then flatten against it
      b.castShadow = false;
      b.userData.noOutline = true;               // an inked blotch reads as a hole
    }

    // ── eyelashes: three on the lid, tipped outward like the sheet ────────
    const lashMat = mat(PALETTE.pupil);
    for (const la of [-0.45, 0, 0.45]) {
      const lash = mesh(new THREE.ConeGeometry(0.020, 0.11, 5), lashMat, this.eyeGroup,
        Math.sin(la) * 0.15, 0.225, 0.10);
      lash.rotation.set(-0.55, 0, -la * 0.9);
      lash.castShadow = false;
      lash.userData.noOutline = true;
    }

    // ── coat details: epaulettes and ragged tails ─────────────────────────
    for (const sx of [-0.44, 0.44]) {
      const ep = mesh(new THREE.SphereGeometry(0.11, 10, 8), goldMat, this.body, sx, 0.30, -0.04);
      ep.scale.set(1, 0.5, 1);
    }
    for (const [tx, rz] of [[-0.16, 0.18], [0.14, -0.14]]) {
      const tail = mesh(new THREE.ConeGeometry(0.10, 0.55, 6), coatMat, this.body, tx, -0.52, -0.34);
      tail.rotation.set(0.45, 0, rz);
    }

    // ── gold hoop earring, because she has one
    const hoop = mesh(new THREE.TorusGeometry(0.075, 0.018, 6, 14), goldMat, this.body, 0.47, 0.28, 0.10);
    hoop.rotation.y = Math.PI / 2;

    // ink outline over the whole thing
    this.outlines = addOutline(this.root, { thickness: 0.022, color: 0x2a1030 });

    // animation scratch state
    this._blink = 2 + Math.random() * 3;
    this._breathe = 0;
    this._tentPhase = 0;   // accumulated, NOT time*freq — see the wave comment
    this._bodyPitch = 0;   // the damped base pitch; charge lean is applied on top
    this._squash = 0;
    this._lean = 0;
    this._hookRaise = 0;
    this._swingT = 0;
  }

  /**
   * @param {number} dt
   * @param {import('./Peggy.js').Peggy} peggy
   * @param {object} ctx  { hookActive, hookAiming, time }
   */
  update(dt, peggy, ctx = {}) {
    const t = ctx.time ?? 0;
    const speed = peggy.speedRatio;
    const phase = peggy.gaitPhase * TAU;

    this.root.position.copy(peggy.position);
    this.root.rotation.y = peggy.facing;

    // ── THE LIMP ──────────────────────────────────────────────────────────
    // Two bobs per stride of unequal amplitude: she drops hard onto the peg
    // (no ankle, no give) and pushes off softly on the good foot. This one
    // asymmetry does more character work than any other line in this file.
    const strideDown = Math.max(0, -Math.sin(phase));       // peg strike
    const strideUp = Math.max(0, Math.sin(phase));          // good foot
    const limp = (strideDown * 0.085 + strideUp * 0.030) * speed;
    const sway = Math.sin(phase) * 0.055 * speed;
    const roll = -Math.sin(phase) * 0.09 * speed;           // lurch toward the peg

    // ── breathing / idle ──────────────────────────────────────────────────
    this._breathe += dt * (1.4 + speed * 2.2);
    const breath = Math.sin(this._breathe) * 0.018 * (1 - speed * 0.6);

    // ── landing squash ────────────────────────────────────────────────────
    this._squash = damp(this._squash, 0, 0.11, dt);
    const inWater = peggy.inWater;

    let bodyY = 0.72 - limp + breath;
    let scaleY = 1 - this._squash;
    let scaleXZ = 1 + this._squash * 0.55;

    if (inWater) {
      // Swimming: she goes horizontal and undulates. The whole body becomes
      // the swim cycle, which is the point of being an octopus.
      const und = Math.sin(t * 4.6) * 0.10;
      this._bodyPitch = lerp(this._bodyPitch, -0.95 + und, 1 - Math.pow(0.001, dt));
      this.body.rotation.z = lerp(this.body.rotation.z, Math.sin(t * 3.1) * 0.12, 1 - Math.pow(0.001, dt));
      bodyY = 0.72 + Math.sin(t * 2.4) * 0.05;
    } else {
      this._bodyPitch = damp(this._bodyPitch, -speed * 0.16, 0.14, dt);
      this.body.rotation.z = damp(this.body.rotation.z, roll, 0.10, dt);
    }
    // The pitch the world sees = the damped base, plus transient offsets that
    // are RECOMPUTED each frame. The charge lean used to do `rotation.x -=`
    // directly, which compounded every frame against the damper and folded her
    // backwards through ~140 degrees over a one-second aim. Offsets on top of
    // a tracked base cannot accumulate, by construction.
    this.body.rotation.x = this._bodyPitch - (ctx.hookCharge || 0) * 0.16;

    this.body.position.y = bodyY;
    this.body.position.x = sway;
    this.body.scale.set(scaleXZ, scaleY, scaleXZ);

    // ── legs ──────────────────────────────────────────────────────────────
    if (inWater) {
      // trailing behind, loose
      this.legL.rotation.x = -0.7 + Math.sin(t * 4.6 + 0.4) * 0.35;
      this.legPeg.rotation.x = -0.7 + Math.sin(t * 4.6) * 0.30;
    } else if (peggy.grounded) {
      // The peg swings stiff and straight; the good leg bends and follows
      // through. Same phase, different curve — that's the limp again.
      this.legPeg.rotation.x = Math.sin(phase) * 0.62 * speed;
      this.legL.rotation.x = -Math.sin(phase) * 0.48 * speed;
      this.legL.rotation.z = 0;
      this.legPeg.rotation.z = 0;
    } else {
      // airborne: peg tucks, good leg reaches
      this.legPeg.rotation.x = damp(this.legPeg.rotation.x, 0.55, 0.15, dt);
      this.legL.rotation.x = damp(this.legL.rotation.x, -0.35, 0.15, dt);
    }

    // ── arms ──────────────────────────────────────────────────────────────
    this._hookRaise = damp(this._hookRaise, ctx.hookActive ? 1 : 0, 0.09, dt);

    // MELEE SWING. Drives straight off the controller's timer so the visual and
    // the hitbox can never disagree. Wind-up is fast and the follow-through is
    // slow — the opposite reads as a limp wave. Each combo stage has its own
    // shape: forehand, backhand (mirrored), then a full-body spin.
    const meleeT = peggy.meleeTimer > 0
      ? 1 - (peggy.meleeTimer / (peggy.meleeDuration || 0.32))   // 0 -> 1
      : -1;
    let swingX = 0, swingY = 0, swingZ = 0;
    if (meleeT >= 0) {
      const stage = peggy.meleeStage || 0;
      if (stage === 2) {
        // THE SPIN: one full turn of the whole body, arm held out stiff, with a
        // little crouch into it. Ease-in-out so it reads as a heave, not a top.
        const spin = smoothstep(meleeT);
        this.body.rotation.y = spin * TAU;
        swingX = -1.1;
        swingZ = 1.35;
        this.body.position.y -= Math.sin(meleeT * Math.PI) * 0.08;
      } else {
        const mirror = stage === 1 ? -1 : 1;   // backhand comes from the other side
        const windUp = clamp01(meleeT / 0.28);
        const strike = clamp01((meleeT - 0.22) / 0.78);
        swingX = lerp(0, -2.0, windUp) + lerp(0, 2.9, smoothstep(strike));
        swingZ = (lerp(0, 1.5, windUp) - lerp(0, 2.2, smoothstep(strike))) * mirror;
        swingY = Math.sin(meleeT * Math.PI) * 0.5 * mirror;
        this.body.rotation.y = Math.sin(meleeT * Math.PI) * 0.42 * mirror;
      }
    } else {
      this.body.rotation.y = damp(this.body.rotation.y, 0, 0.12, dt);
    }

    // hook arm counter-swings, snaps up when the hook fires, and the melee
    // swing overrides both
    this.hookArm.rotation.x = lerp(
      -Math.sin(phase) * 0.38 * speed,
      -1.45,
      this._hookRaise
    ) + swingX;
    // baseline z tips the arm OUT from the fat torso so the run-swing arcs
    // around the belly instead of through it
    this.hookArm.rotation.z = lerp(0.40, -0.25, this._hookRaise) + swingZ;
    this.hookArm.rotation.y = swingY;

    // ── charging the hook: the arm winds back (fresh-assigned above, so this
    //    offset cannot accumulate; the body's lean lives with _bodyPitch) ───
    const charge = ctx.hookCharge || 0;
    if (charge > 0.01) {
      this.hookArm.rotation.x -= charge * 0.9;
    }

    // tentacle arm: a travelling wave down the segments, so it curls rather
    // than swinging like a rigid limb.
    //
    // The phase is ACCUMULATED (phase += freq * dt), never computed as
    // time * freq. With time being minutes since boot, computing it directly
    // means any change in freq — i.e. any change in run speed — multiplies
    // against the whole elapsed time and teleports the phase by tens of
    // radians. That was the "left arm goes absolutely insane while walking":
    // every speed fluctuation scrambled the wave to a random point.
    const wave = inWater ? 3.4 : 1.6 + speed * 3.2;
    this._tentPhase += wave * dt;
    for (let i = 0; i < this.tentacleSegments.length; i++) {
      const seg = this.tentacleSegments[i];
      const off = i * 0.55;
      seg.rotation.x = Math.sin(this._tentPhase - off) * (0.18 + i * 0.05) + (inWater ? 0.25 : 0.10);
      seg.rotation.z = Math.cos(this._tentPhase * 0.7 - off) * (0.10 + i * 0.03);
    }
    this.tentacleArm.rotation.x = Math.sin(phase + Math.PI) * 0.30 * speed;
    this.tentacleArm.rotation.z = -0.40;   // mirrored outward tip

    // The CUTLASS side leads the backhand and joins the spin — hook arm and
    // sword arm trading swings is what sells the combo as three moves rather
    // than one animation played three times.
    if (meleeT >= 0) {
      const stage = peggy.meleeStage || 0;
      if (stage === 1) {
        this.tentacleArm.rotation.x = swingX * 0.9;
        this.tentacleArm.rotation.z = -swingZ * 0.8;
      } else if (stage === 2) {
        this.tentacleArm.rotation.x = -1.0;
        this.tentacleArm.rotation.z = -1.2;
      }
    }

    // bandana tails drag behind at speed
    for (let i = 0; i < this.bandanaTails.length; i++) {
      const tail = this.bandanaTails[i];
      tail.rotation.x = -0.9 - speed * 0.55 + Math.sin(t * 5.2 + i) * 0.12;
      tail.rotation.z = Math.sin(t * 3.7 + i * 1.3) * 0.18;
    }

    // ── the eye ───────────────────────────────────────────────────────────
    this._blink -= dt;
    if (this._blink < 0) this._blink = 1.8 + Math.random() * 3.4;
    // A blink is a fast close and a slower open; equal timing reads robotic.
    const bt = this._blink < 0.14 ? clamp01(1 - Math.abs(this._blink - 0.07) / 0.07) : 0;
    this.lid.rotation.x = lerp(-0.55, 0.85, bt);

    // Look toward travel, so the eye leads the turn instead of trailing it.
    this.iris.position.x = damp(this.iris.position.x, peggy.intent.x * 0.045, 0.12, dt);
    this.iris.position.y = damp(this.iris.position.y, peggy.intent.y * 0.03, 0.12, dt);

    // Scowl harder the faster she goes; wide-eyed in freefall.
    const falling = !peggy.grounded && !inWater && peggy.velocity.y < -6;
    this.brow.rotation.x = damp(this.brow.rotation.x, falling ? -0.35 : 0.25 + speed * 0.28, 0.12, dt);
    const eyeScale = falling ? 1.15 : 1;
    this.eyeGroup.scale.setScalar(damp(this.eyeGroup.scale.x, eyeScale, 0.12, dt));

    // ── mouth: opens with effort and with speed ───────────────────────────
    const openTarget = inWater ? 0.35 : 0.45 + speed * 0.55 + (peggy.grounded ? 0 : 0.35);
    this.mouth.scale.y = damp(this.mouth.scale.y, openTarget, 0.13, dt);
  }

  /** Called on landing, to squash. */
  impact(strength) {
    this._squash = clamp(strength * 0.035, 0, 0.34);
  }

  get object3D() { return this.root; }
}

// ── the real thing, when it exists ─────────────────────────────────────────

let _charGradient = null;
function characterGradient() {
  if (!_charGradient) _charGradient = makeGradientMap([0.35, 0.62, 1.0], [0.74, 0.9, 1.0]);
  return _charGradient;
}

/**
 * The bounding box of the model as RENDERED: bone transforms applied, in the
 * root's space. `getVertexPosition` runs the skinning on the CPU per vertex,
 * so sample rather than visiting every one — a bounds needs ~thousands of
 * points, not a million.
 */
function measureSkinnedBounds(root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh && !o.isSkinnedMesh) return;
    const pos = o.geometry.attributes.position;
    const step = Math.max(1, Math.floor(pos.count / 5000));
    for (let i = 0; i < pos.count; i += step) {
      o.getVertexPosition(i, v).applyMatrix4(o.matrixWorld);
      box.expandByPoint(v);
    }
  });
  return box;
}

export class RiggedPeggyModel {
  /**
   * @param {object} opts
   *   map      THREE.Texture to bind — for models exported without materials
   *   height   world height to normalise to (metres)
   */
  constructor(gltf, opts = {}) {
    this.root = new THREE.Group();
    this.isProxy = false;
    this.scene = gltf.scene;
    this.root.add(this.scene);

    this.scene.traverse((o) => {
      if (!o.isMesh && !o.isSkinnedMesh) return;
      o.castShadow = true;
      o.receiveShadow = false;
      // Scaled skinned meshes routinely fail three's frustum test and vanish
      // at certain camera angles; the character is always on screen anyway.
      o.frustumCulled = false;
      const src = o.material;
      o.material = toonMaterial({
        color: src && src.color ? src.color.getHex() : 0xffffff,
        map: opts.map || (src && src.map) || null,
        // A painterly albedo carries its own lighting cues. The additive warm
        // rim that flatters flat-colour props smears a tan glaze over it —
        // keep only a whisper, for silhouette pop against the sky.
        rimStrength: 0.18,
        // A raised shade floor, for the same reason: the albedo is already
        // dark where it should be dark, and the camera lives BEHIND her — on
        // the standard bands the unlit back crushed to a black cutout.
        gradientMap: characterGradient(),
      });
    });

    // ── clips ─────────────────────────────────────────────────────────────
    this.mixer = new THREE.AnimationMixer(this.scene);
    this.actions = {};
    for (const [key, names] of Object.entries(CLIPS)) {
      const clip = names
        .map((n) => THREE.AnimationClip.findByName(gltf.animations, n))
        .find(Boolean);
      if (!clip) continue;
      const a = this.mixer.clipAction(clip);
      a.enabled = true;
      a.setEffectiveWeight(0);
      // One-shot poses hold their last frame instead of looping — a looping
      // landing plays the crouch over and over.
      if (key === 'jump' || key === 'land') {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      a.play();
      this.actions[key] = a;
    }
    this.current = null;
    this._landT = 0;

    // ── auto-normalise ────────────────────────────────────────────────────
    // DCC exports arrive at arbitrary scales (this one: a 0.01 root from
    // C4D's cm world, Z-up rotation baked into the root). Rather than trust
    // any of it, measure the model and size it to the controller's capsule:
    // feet at y=0, head at `height`, yaw axis through the middle.
    //
    // The measurement MUST be of the POSED, SKINNED vertices — not the raw
    // geometry bounds. Skinned geometry lives in bind space, which on this
    // export bears no resemblance to what the skeleton actually renders:
    // measuring it shipped him 2.8m tall, floating 1.1m off the ground, and
    // yawing about an axis 0.2m in front of his belly. So: pose the skeleton
    // in idle frame 0, run the bones, and measure where the skin really is.
    if (this.actions.idle) {
      this.actions.idle.setEffectiveWeight(1);
      this.mixer.update(0);
    }
    const target = opts.height ?? 1.5;
    let box = measureSkinnedBounds(this.root);
    const size = box.getSize(new THREE.Vector3());
    if (size.y > 1e-5) this.scene.scale.multiplyScalar(target / size.y);
    // Re-measure after scaling rather than doing the algebra — immune to any
    // pre-existing translation on the export's root.
    box = measureSkinnedBounds(this.root);
    const centre = box.getCenter(new THREE.Vector3());
    this.scene.position.x -= centre.x;
    this.scene.position.z -= centre.z;
    this.scene.position.y -= box.min.y;
    if (opts.rotateY) this.scene.rotation.y = opts.rotateY;
  }

  _play(key, fadeHL, dt) {
    if (key !== this.current && this.actions[key]) {
      // Re-entering a one-shot must restart it, or the second jump of a
      // double-jump shows the clamped final frame of the first.
      this.actions[key].reset().play();
    }
    for (const [k, a] of Object.entries(this.actions)) {
      const want = k === key ? 1 : 0;
      a.setEffectiveWeight(damp(a.getEffectiveWeight(), want, fadeHL, dt));
    }
    this.current = key;
  }

  update(dt, peggy, ctx = {}) {
    this.root.position.copy(peggy.position);
    this.root.rotation.y = peggy.facing;

    this._landT = Math.max(0, this._landT - dt);

    let key = 'idle';
    if (peggy.state === 'swing') key = this.actions.swing ? 'swing' : 'fall';
    else if (peggy.state === 'grapple') key = 'fall';
    else if (peggy.state === 'dive') key = this.actions.dive ? 'dive' : 'fall';
    else if (peggy.state === 'swim') key = this.actions.swim ? 'swim' : 'idle';
    else if (!peggy.grounded) key = peggy.velocity.y > 0.5 ? 'jump' : 'fall';
    else if (this._landT > 0 && peggy.speedRatio < 0.3) key = 'land';
    else if (peggy.speedRatio > 0.55) key = 'run';
    else if (peggy.speedRatio > 0.08) key = 'walk';

    if (!this.actions[key]) key = this.actions.idle ? 'idle' : Object.keys(this.actions)[0];
    this._play(key, 0.07, dt);

    // Feet stay honest: locomotion clips scrub with actual ground speed.
    if ((key === 'walk' || key === 'run') && this.actions[key]) {
      this.actions[key].timeScale = clamp(0.6 + peggy.speedRatio * 1.1, 0.5, 2.0);
    }

    this.mixer.update(dt);
  }

  /** Landing kick from main.js — plays the landing clip if she stays put. */
  impact(strength) {
    if (strength > 3) this._landT = 0.5;
  }

  get object3D() { return this.root; }
}

/**
 * Load the best available model, falling back down the chain:
 * a rigged peggy.glb beats the interim glorp character beats the proxy.
 * Never rejects — a missing model must not stop the game booting.
 */
export async function createPeggyModel() {
  const candidates = [
    { url: 'models/peggy.glb' },
    // Interim rigged character. Exported without any material, so the texture
    // rides alongside and is bound here by hand. The file stores LINEAR pixel
    // values (an sRGB->linear conversion got baked in on export): read as
    // ordinary sRGB it averages 7/255 and the whole model renders near-black.
    // Tagging it linear lets the output encode undo the baked conversion and
    // the painted colours come back. Verified against an unlit A/B render.
    { url: 'models/glorp_character.glb', texture: 'images/glorp_texture.webp', texLinear: true },
  ];

  const loader = new GLTFLoader();
  for (const c of candidates) {
    try {
      const gltf = await loader.loadAsync(c.url);
      let map = null;
      if (c.texture) {
        try {
          map = await new THREE.TextureLoader().loadAsync(c.texture);
          // glTF UV convention: v runs top-down, so the texture must not flip.
          map.flipY = false;
          map.colorSpace = c.texLinear ? THREE.LinearSRGBColorSpace : THREE.SRGBColorSpace;
        } catch {
          console.warn('[peggy] texture missing:', c.texture);
        }
      }
      console.info('[peggy] rigged model:', c.url,
        '· clips:', gltf.animations.map((a) => a.name).join(', ') || '(none)');
      return new RiggedPeggyModel(gltf, { map, height: 1.5 });
    } catch { /* try the next candidate */ }
  }
  console.info('[peggy] no rigged model found — using the procedural proxy.');
  return new ProxyPeggyModel();
}

export { CLIPS };
