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
};

const POOL = 10;
const PUFFS = 8;
const AIM_DOTS = 22;        // ghost dots along the previewed arc
const AIM_SPACING = 0.7;    // metres between them
const _Z = new THREE.Vector3(0, 0, 1);

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

    // ── the aim ghost ──────────────────────────────────────────────────────
    // While the trigger is held, the flight the NEXT ball would take is drawn
    // in the world: the same ballistics stepped ahead of time, dotted along
    // the arc — bounces included, because the simulation IS the flight code,
    // so the preview cannot lie. The dots march away from the muzzle so the
    // line reads as flow rather than a fence, and a ring marks where the ball
    // finally spends itself. Ghosts write no depth, so the ink pass leaves
    // them un-outlined — see-through by construction.
    this._aimDots = new THREE.InstancedMesh(
      new THREE.OctahedronGeometry(0.085, 0),
      new THREE.MeshBasicMaterial({ color: 0xfff1c9, transparent: true, opacity: 0.55, depthWrite: false }),
      AIM_DOTS
    );
    this._aimDots.frustumCulled = false;
    this._aimDots.renderOrder = 19;
    this._aimDots.count = 0;
    this._aimDots.visible = false;
    scene.add(this._aimDots);

    this._aimRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.34, 0.04, 6, 22),
      new THREE.MeshBasicMaterial({ color: 0xffd97a, transparent: true, opacity: 0.6, depthWrite: false })
    );
    this._aimRing.renderOrder = 19;
    this._aimRing.visible = false;
    scene.add(this._aimRing);

    this._aimPhase = 0;
    this._m4 = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._sc = new THREE.Vector3();
    this._p3 = new THREE.Vector3();
    this._v3 = new THREE.Vector3();
    this._d3 = new THREE.Vector3();
  }

  /**
   * Draw the ghost of the shot `dir` would take from `origin`. Call every
   * frame the trigger is held; call aimOff() when it isn't.
   */
  aim(dt, origin, dir, world) {
    const H = 1 / 60;                                  // sim step — a ghost can be coarser than a ball
    this._aimPhase = (this._aimPhase + dt * 7) % AIM_SPACING;

    const p = this._p3.copy(origin);
    const vel = this._v3.copy(dir).multiplyScalar(T.speed);
    vel.y += T.lift;

    let mark = 0.9 + this._aimPhase;                   // first dot clear of her arm
    let dist = 0, bounces = 0, n = 0, life = T.life;
    let endN = null;                                   // surface normal where the arc ends

    while (life > 0) {
      life -= H;
      vel.y -= T.gravity * H;
      const step = vel.length() * H;
      p.addScaledVector(vel, H);

      while (dist + step >= mark && n < AIM_DOTS) {
        const back = (dist + step - mark) / Math.max(step, 1e-6);
        this._d3.copy(p).addScaledVector(vel, -back * H);
        this._sc.setScalar(1 - 0.55 * (n / AIM_DOTS)); // taper with distance
        this._m4.compose(this._d3, this._q, this._sc);
        this._aimDots.setMatrixAt(n++, this._m4);
        mark += AIM_SPACING;
      }
      dist += step;

      const wall = this._solidHit(world.level, p);
      if (wall) {
        if (bounces < T.bounces && vel.length() > 5) {
          const dot = vel.x * wall.x + vel.z * wall.z;
          vel.x -= 2 * dot * wall.x;
          vel.z -= 2 * dot * wall.z;
          vel.multiplyScalar(T.restitution);
          bounces++;
        } else { endN = _UP; break; }
      }

      const g = world.level.groundAt(p.x, p.z, Infinity, this._g || (this._g = {}));
      if (p.y <= g.y + T.radius) {
        if (bounces < T.bounces && vel.length() > 5) {
          p.y = g.y + T.radius;
          const nrm = g.normal || _UP;
          const d = vel.dot(nrm);
          vel.addScaledVector(nrm, -2 * d).multiplyScalar(T.restitution);
          bounces++;
        } else { endN = g.normal || _UP; break; }
      }

      const w = world.water.heightAt(p.x, p.z);
      if (p.y <= w + T.radius * 0.5) { p.y = w + 0.03; endN = _UP; break; }
    }

    this._aimDots.count = n;
    this._aimDots.instanceMatrix.needsUpdate = true;
    this._aimDots.visible = n > 0;

    if (endN) {
      this._aimRing.position.copy(p).addScaledVector(endN, 0.05);
      this._aimRing.quaternion.setFromUnitVectors(_Z, endN);   // torus axis is +Z
      this._aimRing.visible = true;
    } else {
      this._aimRing.visible = false;
    }
  }

  aimOff() {
    this._aimDots.visible = false;
    this._aimRing.visible = false;
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
