// The hand cannon.
//
// She has a skull-faced blunderbuss strapped to her left fist; this is what
// comes out of it. Deliberately simple ballistics: cannonballs fly fast and
// FALL, because a projectile with an arc invites aiming up hills and lobbing
// over crates in a way a hitscan ray never does.
//
// Pooled, like anything that spawns at 3 rounds a second. A ball that hits a
// crab hurts it; a ball that hits a barrel knocks it flying (and enough of
// them stave it in); a ball that hits a wall ricochets; ground or water gets
// a little pop of a puff. No friendly-fire, no self-damage, no ammo — the
// trigger is the resource.

import * as THREE from '../../vendor/three/three.module.js';
import { BoxSolid } from '../world/Level.js';

const _UP = new THREE.Vector3(0, 1, 0);

const T = {
  speed: 26,           // m/s at the muzzle — Robits bullets are FAST
  lift: 1.6,           // small up-kick so level shots carry before falling
  gravity: 16,
  life: 2.4,           // seconds before a ball gives up
  radius: 0.09,
  hitRadius: 0.62,     // vs a crab's centre
  power: 12,           // one shot pops one hp — same as a sword hit
  knock: 8,            // shove given to a barrel — under the sword's 11
  bounces: 2,          // skips off the ground before the ball gives up
  restitution: 0.55,   // energy kept per skip
  lockRange: 19,       // aim assist: how far it will find a target
  lockCone: 0.86,      // ...and how close to the stick's heading (~30 degrees)
};

const POOL = 10;
const PUFFS = 8;

export class Cannon {
  constructor(scene) {
    this.shots = 0;    // lifetime counter, mostly for tests

    const geo = new THREE.SphereGeometry(T.radius, 10, 8);
    const mat = new THREE.MeshBasicMaterial({ color: 0x232830 });
    this._balls = [];
    for (let i = 0; i < POOL; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      scene.add(m);
      this._balls.push({ m, vel: new THREE.Vector3(), life: 0 });
    }

    // impact puffs: a little sphere that swells and fades
    const puffGeo = new THREE.SphereGeometry(0.16, 8, 6);
    this._puffs = [];
    for (let i = 0; i < PUFFS; i++) {
      const m = new THREE.Mesh(puffGeo, new THREE.MeshBasicMaterial({
        color: 0xf2ede0, transparent: true, opacity: 0.85,
      }));
      m.visible = false;
      scene.add(m);
      this._puffs.push({ m, t: 0 });
    }

    // ── the lock ring ──────────────────────────────────────────────────────
    // Soft aim assist, the way the Robits gun worked: while the trigger is
    // held, the nearest target inside the stick's cone gets a spinning gold
    // ring around it, and shots steer to that point. No centre-screen
    // chrome — the ring lives on the TARGET, and only exists while there is
    // one. Writes no depth, so the ink pass leaves it un-outlined.
    this._ring = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.055, 6, 24),
      new THREE.MeshBasicMaterial({ color: 0xffd97a, transparent: true, opacity: 0.85, depthWrite: false })
    );
    this._ring.rotation.x = Math.PI / 2;
    this._ring.renderOrder = 19;
    this._ring.visible = false;
    // three beads riding the ring, so the spin is visible on a shape that is
    // otherwise rotationally symmetric
    const beadGeo = new THREE.SphereGeometry(0.11, 8, 6);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const bead = new THREE.Mesh(beadGeo, this._ring.material);
      bead.position.set(Math.cos(a), Math.sin(a), 0);
      this._ring.add(bead);
    }
    scene.add(this._ring);
    this._ringSpin = 0;
    this.lock = null;
  }

  /**
   * Find the target the held trigger should steer toward: nearest live crab
   * or barrel inside the aim cone. Call every frame the trigger is held —
   * it also parks the lock ring on whatever it found. lockOff() clears it.
   * @returns {{x,y,z,r}|null} the aim point, or null when nothing locks.
   */
  acquire(dt, origin, dir, world) {
    let best = null, bestScore = Infinity;
    const consider = (x, y, z, r, ringY) => {
      const dx = x - origin.x, dz = z - origin.z;
      const dh = Math.hypot(dx, dz);
      if (dh > T.lockRange || dh < 1.2) return;
      const dot = (dx / dh) * dir.x + (dz / dh) * dir.z;
      if (dot < T.lockCone) return;
      const score = dh * (2 - dot);
      if (score < bestScore) { bestScore = score; best = { x, y, z, r, ringY }; }
    };
    if (world.crabs) {
      for (const c of world.crabs) {
        if (c.dead || c.hp <= 0) continue;
        consider(c.position.x, c.position.y + 0.35, c.position.z, 0.95, c.position.y + 0.14);
      }
    }
    if (world.loose) {
      for (const h of world.loose) {
        if (h.dead || h.held) continue;
        consider(h.position.x, h.position.y, h.position.z, h.radius + 0.35, h.position.y - h.radius + 0.16);
      }
    }
    this.lock = best;

    if (best) {
      this._ringSpin += dt * 2.4;
      const pulse = 1 + Math.sin(this._ringSpin * 4.5) * 0.05;
      this._ring.position.set(best.x, best.ringY, best.z);
      this._ring.rotation.z = this._ringSpin;
      this._ring.scale.setScalar(best.r * pulse);
      this._ring.visible = true;
    } else {
      this._ring.visible = false;
    }
    return best;
  }

  lockOff() {
    this.lock = null;
    this._ring.visible = false;
  }

  fire(origin, dir) {
    const b = this._balls.find((x) => x.life <= 0) || this._balls[0];
    b.m.position.copy(origin);
    b.vel.copy(dir).multiplyScalar(T.speed);
    b.vel.y += T.lift;
    b.life = T.life;
    b.bounces = 0;
    b.m.visible = true;
    this.shots++;
  }

  _puff(pos, color) {
    const p = this._puffs.find((x) => x.t <= 0) || this._puffs[0];
    p.m.position.copy(pos);
    p.m.material.color.set(color);
    p.t = 0.28;
    p.m.visible = true;
  }

  /**
   * A ball flying INSIDE a solid's side wall. groundAt() only knows about
   * solid TOPS, so without this a shot sailed clean through the flank of a
   * crate, a pillar, the mast. Pushes the ball out along the axis of least
   * penetration (mirroring Level.resolveHorizontal) and returns the wall's
   * horizontal normal so the caller can ricochet off it.
   */
  _solidHit(level, p) {
    const r = T.radius;
    for (const s of level.solids) {
      if (p.y > s.top || p.y < s.bottom) continue;
      if (s instanceof BoxSolid) {
        const l = this._l || (this._l = { x: 0, z: 0 });
        s.toLocal(p.x, p.z, l);
        const px = s.half.x + r - Math.abs(l.x);
        const pz = s.half.z + r - Math.abs(l.z);
        if (px <= 0 || pz <= 0) continue;
        const d = this._d || (this._d = { x: 0, z: 0 });
        if (px < pz) s.toWorldDir(Math.sign(l.x || 1), 0, d);
        else s.toWorldDir(0, Math.sign(l.z || 1), d);
        const depth = Math.min(px, pz);
        p.x += d.x * depth; p.z += d.z * depth;
        return d;
      } else {
        const dx = p.x - s.centre.x, dz = p.z - s.centre.z;
        const dist = Math.hypot(dx, dz);
        const minD = s.radius + r;
        if (dist >= minD || dist < 1e-5) continue;
        const n = this._d || (this._d = { x: 0, z: 0 });
        n.x = dx / dist; n.z = dz / dist;
        p.x = s.centre.x + n.x * minD;
        p.z = s.centre.z + n.z * minD;
        return n;
      }
    }
    return null;
  }

  /**
   * @param world  { level, water, crabs, loose }
   */
  update(dt, world) {
    for (const b of this._balls) {
      if (b.life <= 0) continue;
      b.life -= dt;
      b.vel.y -= T.gravity * dt;
      b.m.position.addScaledVector(b.vel, dt);
      const p = b.m.position;

      let dead = b.life <= 0;

      // crabs first — a ball that reaches a crab should never be stolen by
      // the sand it was standing on
      if (!dead && world.crabs) {
        for (const crab of world.crabs) {
          if (crab.hp <= 0) continue;
          const dx = p.x - crab.position.x, dy = p.y - (crab.position.y + 0.35), dz = p.z - crab.position.z;
          if (dx * dx + dy * dy + dz * dz < T.hitRadius * T.hitRadius) {
            const l = Math.hypot(b.vel.x, b.vel.z) || 1;
            crab.hit(b.vel.x / l, b.vel.z / l, T.power);
            this._puff(p, 0xffd98f);
            dead = true;
            break;
          }
        }
      }

      // barrels and any other loose prop: exactly the kind of thing a
      // blunderbuss is for. hit() knocks it flying, and enough hits stave it in.
      if (!dead && world.loose) {
        for (const h of world.loose) {
          if (h.held || h.dead || !h.hit) continue;
          const rr = h.radius + T.radius + 0.12;
          const dx = p.x - h.position.x, dy = p.y - h.position.y, dz = p.z - h.position.z;
          if (dx * dx + dy * dy + dz * dz < rr * rr) {
            const l = Math.hypot(b.vel.x, b.vel.z) || 1;
            h.hit(b.vel.x / l, b.vel.z / l, T.knock);
            this._puff(p, 0xe8d9b0);
            dead = true;
            break;
          }
        }
      }

      // walls: ricochet off the sides of crates, pillars, the mast — sharing
      // the same bounce budget as a ground skip, so a ball pinballs a couple
      // of times and then gives up.
      if (!dead) {
        const n = this._solidHit(world.level, p);
        if (n) {
          const speed = b.vel.length();
          if (b.bounces < T.bounces && speed > 5) {
            const dot = b.vel.x * n.x + b.vel.z * n.z;
            b.vel.x -= 2 * dot * n.x;
            b.vel.z -= 2 * dot * n.z;
            b.vel.multiplyScalar(T.restitution);
            b.bounces++;
            this._puff(p, 0xcbb89b);
          } else {
            this._puff(p, 0xcbb89b);
            dead = true;
          }
        }
      }

      // terrain: SKIP off it, don't die into it. The aim is horizontal and
      // the island is all hills — a ball that buried itself into the first
      // upslope made shooting uphill impossible. Bouncing carries the shot up
      // the terrain the way a cannonball actually would, and reads great.
      if (!dead) {
        const g = world.level.groundAt(p.x, p.z, Infinity, this._g || (this._g = {}));
        if (p.y <= g.y + T.radius) {
          const speed = b.vel.length();
          if (b.bounces < T.bounces && speed > 5) {
            p.y = g.y + T.radius;
            const n = g.normal || _UP;
            const dot = b.vel.dot(n);
            b.vel.addScaledVector(n, -2 * dot).multiplyScalar(T.restitution);
            b.bounces++;
            this._puff(p, 0xd9c9a0);
          } else {
            this._puff(p, 0xd9c9a0);
            dead = true;
          }
        }
      }
      // the sea
      if (!dead) {
        const w = world.water.heightAt(p.x, p.z);
        if (p.y <= w + T.radius * 0.5) { this._puff(p, 0xdff6f2); dead = true; }
      }

      if (dead) { b.life = 0; b.m.visible = false; }
    }

    for (const puff of this._puffs) {
      if (puff.t <= 0) continue;
      puff.t -= dt;
      const k = 1 - puff.t / 0.28;
      puff.m.scale.setScalar(0.5 + k * 2.2);
      puff.m.material.opacity = 0.85 * (1 - k);
      if (puff.t <= 0) puff.m.visible = false;
    }
  }
}

export { T as CANNON_TUNING };
