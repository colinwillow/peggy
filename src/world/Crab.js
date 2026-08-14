// Grog crabs — the first bad guys.
//
// Modelled on Crabby from the character sheets: a fat red body, oversized
// mismatched claws, worried little eyes, and a pirate hat, because everyone on
// this island has a pirate hat.
//
// Behaviour is deliberately simple bordering on comic: they bumble around
// their home patch, scuttle at Peggy when she's close, and exist to be hit.
// A melee swing sends them flying with the same knock physics as the barrels;
// two hits pops them in a puff and they burst into doubloons. They respawn at
// home after a while, because a combat sandbox with no targets left in it is
// a sandbox you stop playing.
//
// They cannot hurt her yet — there is no health system to hurt. When damage
// arrives, the contact check in update() is where it starts.

import * as THREE from '../../vendor/three/three.module.js';
import { toonMaterial } from '../render/toon.js';
import { clamp01, damp, lerp, rand, TAU } from '../core/math.js';

const CRAB = {
  wanderRadius: 4.0,
  wanderSpeed: 1.1,
  chaseSpeed: 2.4,
  aggroRange: 9.0,
  loseRange: 13.0,
  hp: 2,
  respawnTime: 24,
  coinDrop: 3,
  gravity: 22,
};

let _shellMat, _shellDark, _clawMat, _bellyMat, _eyeMat, _pupilMat, _hatMat, _boneMat;
function mats() {
  if (_shellMat) return;
  _shellMat = toonMaterial({ color: 0xd4523a });
  _shellDark = toonMaterial({ color: 0xa93c2a });
  _clawMat = toonMaterial({ color: 0xe06848 });
  _bellyMat = toonMaterial({ color: 0xe8c9a0 });
  _eyeMat = toonMaterial({ color: 0xfdf7ea });
  _pupilMat = toonMaterial({ color: 0x1a1420 });
  _hatMat = toonMaterial({ color: 0x3c3552 });
  _boneMat = toonMaterial({ color: 0xf0e6cf });
}

function part(geo, material, parent, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

export class Crab {
  constructor(level, x, z) {
    mats();
    this.level = level;
    this.home = new THREE.Vector3(x, level.groundAt(x, z, Infinity, {}).y, z);
    this.position = this.home.clone();
    this.vel = new THREE.Vector3();
    this.facing = rand(0, TAU);
    this.hp = CRAB.hp;
    this.dead = false;
    this._respawnT = 0;
    this._stunT = 0;
    this._wanderT = 0;
    this._wanderDir = rand(0, TAU);
    this._scuttle = rand(0, TAU);
    this._flash = 0;
    this._popT = 0;          // death shrink
    /** Set true for one frame when it pops — main.js spawns the coins. */
    this.justDied = false;

    this.root = new THREE.Group();
    this._build();
    this.root.position.copy(this.position);
  }

  _build() {
    const g = this.root;

    const bodyGeo = new THREE.SphereGeometry(0.52, 16, 12);
    bodyGeo.scale(1.15, 0.82, 0.95);
    this.body = part(bodyGeo, _shellMat, g, 0, 0.45, 0);

    const bellyGeo = new THREE.SphereGeometry(0.42, 12, 10);
    bellyGeo.scale(1.05, 0.72, 0.85);
    part(bellyGeo, _bellyMat, this.body, 0, -0.12, 0.10);

    // the worried eyes, close-set on top
    for (const ex of [-0.14, 0.14]) {
      const eye = part(new THREE.SphereGeometry(0.13, 10, 8), _eyeMat, this.body, ex, 0.38, 0.28);
      part(new THREE.SphereGeometry(0.055, 8, 6), _pupilMat, eye, 0, 0.02, 0.10);
    }

    // tiny pirate hat, tilted
    const hat = new THREE.Group();
    hat.position.set(0.06, 0.58, 0.02);
    hat.rotation.z = -0.22;
    this.body.add(hat);
    part(new THREE.CylinderGeometry(0.16, 0.20, 0.16, 10), _hatMat, hat, 0, 0.08, 0);
    const brim = part(new THREE.CylinderGeometry(0.30, 0.28, 0.045, 12), _hatMat, hat);
    brim.scale.z = 0.8;
    const skull = part(new THREE.SphereGeometry(0.05, 8, 6), _boneMat, hat, 0, 0.10, 0.17);
    skull.scale.set(1, 0.9, 0.5);

    // claws: one huge, one small — the asymmetry is the character
    this.clawBig = new THREE.Group();
    this.clawBig.position.set(0.62, 0.42, 0.18);
    g.add(this.clawBig);
    const bigGeo = new THREE.SphereGeometry(0.30, 12, 10);
    bigGeo.scale(1.25, 1.0, 0.8);
    part(bigGeo, _clawMat, this.clawBig, 0.18, 0.05, 0);
    part(new THREE.ConeGeometry(0.12, 0.28, 8), _clawMat, this.clawBig, 0.42, 0.22, 0).rotation.z = -0.5;

    this.clawSmall = new THREE.Group();
    this.clawSmall.position.set(-0.60, 0.36, 0.18);
    g.add(this.clawSmall);
    const smallGeo = new THREE.SphereGeometry(0.17, 10, 8);
    smallGeo.scale(1.2, 1, 0.8);
    part(smallGeo, _clawMat, this.clawSmall, -0.10, 0.02, 0);

    // six stubby legs
    this.legs = [];
    for (let i = 0; i < 6; i++) {
      const side = i < 3 ? 1 : -1;
      const li = i % 3;
      const leg = part(new THREE.ConeGeometry(0.055, 0.34, 6), _shellDark, g,
        side * 0.42, 0.22, -0.22 + li * 0.24);
      leg.rotation.z = side * 0.9;
      this.legs.push(leg);
    }
  }

  /** A melee connect. Direction is away from the striker. */
  hit(dirX, dirZ, power) {
    if (this.dead) return false;
    this.hp--;
    this._flash = 0.18;
    this._stunT = 0.8;
    this.vel.set(dirX * power * 0.7, power * 0.5, dirZ * power * 0.7);
    if (this.hp <= 0) {
      this.dead = true;
      this.justDied = true;
      this._popT = 0.3;
      this._respawnT = CRAB.respawnTime;
    }
    return true;
  }

  update(dt, peggy) {
    const g = this.root;

    // ── dead: shrink out, wait, pop back at home ──────────────────────────
    if (this.dead) {
      if (this._popT > 0) {
        this._popT -= dt;
        g.scale.setScalar(Math.max(this._popT / 0.3, 0.001));
        g.position.y += dt * 2;
        return;
      }
      g.visible = false;
      this._respawnT -= dt;
      if (this._respawnT <= 0) {
        this.dead = false;
        this.hp = CRAB.hp;
        this.position.copy(this.home);
        this.vel.set(0, 0, 0);
        g.visible = true;
        g.scale.setScalar(0.001);
      }
      return;
    }
    // respawn grow-in
    if (g.scale.x < 1) g.scale.setScalar(Math.min(1, g.scale.x + dt * 3));

    this._flash = Math.max(0, this._flash - dt);
    this.body.material = this._flash > 0 ? _bellyMat : _shellMat;

    const ground = this.level.groundAt(this.position.x, this.position.z, Infinity, {}).y;
    const airborne = this.position.y > ground + 0.05;

    if (this._stunT > 0 || airborne) {
      // ── knocked: ballistic, no steering, bounce and settle ──────────────
      this._stunT = Math.max(0, this._stunT - dt);
      this.vel.y -= CRAB.gravity * dt;
      this.position.addScaledVector(this.vel, dt);
      if (this.position.y <= ground) {
        this.position.y = ground;
        if (this.vel.y < -2) this.vel.y *= -0.3;
        else this.vel.y = 0;
        const f = Math.pow(0.05, dt);
        this.vel.x *= f; this.vel.z *= f;
      }
      g.rotation.z = damp(g.rotation.z, this._stunT > 0 ? 0.6 : 0, 0.2, dt);
    } else {
      // ── walking: wander at home, scuttle at Peggy when close ────────────
      const toPeggy = Math.hypot(peggy.position.x - this.position.x, peggy.position.z - this.position.z);
      let tx, tz, speed;
      if (toPeggy < CRAB.aggroRange && !peggy.inWater) {
        tx = peggy.position.x; tz = peggy.position.z;
        speed = CRAB.chaseSpeed;
      } else {
        this._wanderT -= dt;
        if (this._wanderT <= 0) {
          this._wanderT = rand(1.2, 3);
          const a = rand(0, TAU), r = rand(0, CRAB.wanderRadius);
          this._wx = this.home.x + Math.cos(a) * r;
          this._wz = this.home.z + Math.sin(a) * r;
        }
        tx = this._wx ?? this.home.x; tz = this._wz ?? this.home.z;
        speed = CRAB.wanderSpeed;
      }
      const dx = tx - this.position.x, dz = tz - this.position.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.4) {
        const nx = dx / d, nz = dz / d;
        // never walks into the sea — crabs, ironically, hate getting wet
        const aheadG = this.level.groundAt(this.position.x + nx, this.position.z + nz, Infinity, {}).y;
        if (aheadG > 0.2) {
          this.position.x += nx * speed * dt;
          this.position.z += nz * speed * dt;
          this.facing = damp(this.facing, Math.atan2(nx, nz), 0.15, dt);
        }
      }
      this.position.y = ground;
      g.rotation.z = 0;
    }

    // ── animation ─────────────────────────────────────────────────────────
    const moving = this.vel.lengthSq() > 0.01 || this._stunT === 0;
    this._scuttle += dt * (8 + clamp01(this.vel.length()) * 6);
    for (let i = 0; i < this.legs.length; i++) {
      const leg = this.legs[i];
      const side = i < 3 ? 1 : -1;
      leg.rotation.x = Math.sin(this._scuttle + i * 1.1) * 0.35 * (moving ? 1 : 0.2);
      leg.rotation.z = side * 0.9;
    }
    this.clawBig.rotation.z = Math.sin(this._scuttle * 0.5) * 0.22 - 0.1;
    this.clawSmall.rotation.z = -Math.sin(this._scuttle * 0.5 + 1) * 0.28;
    this.body.position.y = 0.45 + Math.sin(this._scuttle * 2) * 0.02;

    g.position.copy(this.position);
    g.rotation.y = this.facing;
  }
}

export { CRAB };
