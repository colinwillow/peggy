// The hand cannon.
//
// She has a skull-faced blunderbuss strapped to her left fist; this is what
// comes out of it. Deliberately simple ballistics: cannonballs fly fast and
// FALL, because a projectile with an arc invites aiming up hills and lobbing
// over crates in a way a hitscan ray never does.
//
// Pooled, like anything that spawns at 3 rounds a second. A ball that hits a
// crab hurts it; a ball that hits ground or water leaves a little pop of a
// puff and is gone. No friendly-fire, no self-damage, no ammo — the trigger
// is the resource.

import * as THREE from '../../vendor/three/three.module.js';

const T = {
  speed: 21,           // m/s at the muzzle
  lift: 2.2,           // small up-kick so level shots carry before falling
  gravity: 16,
  life: 2.4,           // seconds before a ball gives up
  radius: 0.09,
  hitRadius: 0.62,     // vs a crab's centre
  power: 12,           // one shot pops one hp — same as a sword hit
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
  }

  fire(origin, dir) {
    const b = this._balls.find((x) => x.life <= 0) || this._balls[0];
    b.m.position.copy(origin);
    b.vel.copy(dir).multiplyScalar(T.speed);
    b.vel.y += T.lift;
    b.life = T.life;
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
   * @param world  { level, water, crabs }
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

      // terrain / solids
      if (!dead) {
        const g = world.level.groundAt(p.x, p.z, Infinity, this._g || (this._g = {}));
        if (p.y <= g.y + T.radius) { this._puff(p, 0xd9c9a0); dead = true; }
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
