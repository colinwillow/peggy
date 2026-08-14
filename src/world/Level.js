// Level: the collision world.
//
// Deliberately analytic rather than mesh-based. A pirate world is islands,
// crates, hulls, masts and planks — a heightfield plus a pile of boxes and
// cylinders describes all of it, samples in microseconds, and never produces
// the "fell through the seam between two triangles" bug that plagues raycasting
// against arbitrary geometry. The visual mesh is GENERATED FROM the same height
// function, so what you see is exactly what you collide with.
//
// Ground rules for the vertical axis: y = 0 is sea level, everywhere.

import * as THREE from '../../vendor/three/three.module.js';
import { clamp, clamp01, smoothstep } from '../core/math.js';

// ── deterministic value noise ──────────────────────────────────────────────
// Islands need coastlines that wobble. A hash-based value noise is enough and,
// unlike Math.random, gives the same island every load.

function hash2(x, y) {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

function valueNoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function fbm(x, y, octaves = 3) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, y * freq) * amp;
    norm += amp;
    amp *= 0.5; freq *= 2.03;
  }
  return sum / norm;
}

// ── solids ─────────────────────────────────────────────────────────────────

export class BoxSolid {
  /** @param {THREE.Vector3} centre @param {THREE.Vector3} half */
  constructor(centre, half, rotY = 0, tag = '') {
    this.centre = centre;
    this.half = half;
    this.rotY = rotY;
    this.tag = tag;
    this._cos = Math.cos(-rotY);
    this._sin = Math.sin(-rotY);
  }
  /** World point -> the box's local frame. */
  toLocal(x, z, out) {
    const dx = x - this.centre.x, dz = z - this.centre.z;
    out.x = dx * this._cos - dz * this._sin;
    out.z = dx * this._sin + dz * this._cos;
    return out;
  }
  /** Local offset -> world. */
  toWorldDir(lx, lz, out) {
    const c = Math.cos(this.rotY), s = Math.sin(this.rotY);
    out.x = lx * c - lz * s;
    out.z = lx * s + lz * c;
    return out;
  }
  get top() { return this.centre.y + this.half.y; }
  get bottom() { return this.centre.y - this.half.y; }
}

export class CylinderSolid {
  constructor(centre, radius, halfHeight, tag = '') {
    this.centre = centre;
    this.radius = radius;
    this.halfHeight = halfHeight;
    this.tag = tag;
  }
  get top() { return this.centre.y + this.halfHeight; }
  get bottom() { return this.centre.y - this.halfHeight; }
}

// ── level ──────────────────────────────────────────────────────────────────

const _local = { x: 0, z: 0 };
const _dir = { x: 0, z: 0 };

export class Level {
  constructor() {
    /** @type {Array<{cx:number,cz:number,radius:number,height:number,plateau:number,rough:number,noiseScale:number}>} */
    this.islands = [];
    /** @type {Array<BoxSolid|CylinderSolid>} */
    this.solids = [];
    /** Anchors the hook can latch onto. */
    this.grapplePoints = [];
    /** Loose objects the hook can reel in. */
    this.haulables = [];
    /** Things a tap can act on when you're stood near them. */
    this.interactables = [];
    this.seaLevel = 0;
    /** Below this, the terrain is open ocean and there is no floor at all. */
    this.abyss = -40;
  }

  addIsland(def) {
    this.islands.push({
      cx: def.cx, cz: def.cz,
      radius: def.radius,
      height: def.height,
      plateau: def.plateau ?? 0.42,   // fraction of the radius that stays flat on top
      rough: def.rough ?? 0.18,       // how much the coastline wobbles
      noiseScale: def.noiseScale ?? 0.045,
      beach: def.beach ?? 0.9,        // metres of near-flat sand around sea level
    });
    return this;
  }

  addSolid(s) { this.solids.push(s); return this; }

  /**
   * Register a context action.
   * @param {object} def
   *   pos      THREE.Vector3 — where the prompt hovers
   *   radius   how close she has to be
   *   icon     key into the SVG sprite: 'chest' | 'door' | 'wheel'
   *   label    short verb shown under the icon
   *   onInteract(peggy) — return false to keep the prompt available
   */
  addInteractable(def) {
    this.interactables.push({
      pos: def.pos.clone(),
      radius: def.radius ?? 2.6,
      icon: def.icon ?? 'chest',
      label: def.label ?? 'USE',
      used: false,
      once: def.once !== false,
      onInteract: def.onInteract || (() => {}),
    });
    return this.interactables[this.interactables.length - 1];
  }

  /**
   * Nearest usable thing to `pos`, preferring what she's facing.
   *
   * Facing matters because interact SHARES ITS INPUT WITH JUMP — every prompt
   * that lights up is a jump the player can't make. Requiring her to be turned
   * toward the thing keeps that theft deliberate rather than incidental.
   */
  findInteractable(pos, facing) {
    const fx = Math.sin(facing), fz = Math.cos(facing);
    let best = null, bestScore = Infinity;
    for (const it of this.interactables) {
      if (it.used && it.once) continue;
      const dx = it.pos.x - pos.x, dz = it.pos.z - pos.z;
      const dy = it.pos.y - pos.y;
      if (Math.abs(dy) > 3.0) continue;
      const d = Math.hypot(dx, dz);
      if (d > it.radius) continue;
      // Right on top of it, facing stops mattering — you can't turn toward
      // something you're standing in.
      const dot = d < 0.8 ? 1 : (dx * fx + dz * fz) / d;
      if (dot < -0.15) continue;
      const score = d * (1.5 - dot);
      if (score < bestScore) { bestScore = score; best = it; }
    }
    return best;
  }

  addGrapplePoint(pos, opts = {}) {
    this.grapplePoints.push({
      pos: pos.clone(),
      kind: opts.kind ?? 'anchor',   // 'anchor' = pull yourself to it, 'swing' = hang and swing
      radius: opts.radius ?? 1.0,
      // A BAR rather than a point: a horizontal segment the hook can latch
      // anywhere along, monkey-bar style. axis is the bar's direction in the
      // XZ plane; halfLen its half-length. The latch point is computed per
      // query as the closest point on the segment to the thrower.
      axisX: opts.axisX ?? 0,
      axisZ: opts.axisZ ?? 0,
      halfLen: opts.halfLen ?? 0,
    });
    return this.grapplePoints[this.grapplePoints.length - 1];
  }

  // ── terrain ──────────────────────────────────────────────────────────────

  /**
   * Terrain height from the island field alone (no solids). This is both the
   * collision surface and the surface the visual mesh is built from.
   */
  terrainHeight(x, z) {
    let h = this.abyss;
    for (const isl of this.islands) {
      const dx = x - isl.cx, dz = z - isl.cz;
      const dist = Math.hypot(dx, dz);

      // wobble the effective radius so the coastline isn't a circle
      const n = fbm(x * isl.noiseScale, z * isl.noiseScale, 3) - 0.5;
      const r = isl.radius * (1 + n * isl.rough * 2);
      if (dist > r) continue;

      const t = dist / r;
      // plateau on top, then a shoulder down to the waterline
      let f = 1 - smoothstep((t - isl.plateau) / (1 - isl.plateau));
      // second noise octave for lumps on the surface itself
      const bump = (fbm(x * isl.noiseScale * 3.1 + 100, z * isl.noiseScale * 3.1 + 100, 2) - 0.5);
      let y = isl.height * f + bump * isl.height * 0.16 * f;

      // flatten a beach band either side of sea level so shores are walkable
      // instead of a cliff that drops straight into deep water
      if (y > -isl.beach && y < isl.beach) {
        y *= 0.35;
      }
      if (y > h) h = y;
    }
    return h;
  }

  /** Surface normal, by finite difference on the terrain height. */
  terrainNormal(x, z, out = new THREE.Vector3()) {
    const e = 0.35;
    const hL = this.terrainHeight(x - e, z), hR = this.terrainHeight(x + e, z);
    const hD = this.terrainHeight(x, z - e), hU = this.terrainHeight(x, z + e);
    out.set(hL - hR, 2 * e, hD - hU).normalize();
    return out;
  }

  /**
   * Highest walkable surface at (x, z) that is at or below `fromY`.
   * Returns { y, normal, solid } — solid is null when it's terrain.
   *
   * `fromY` matters: standing on a crate you want the crate's top, but jumping
   * up past it you want the crate's top again once you're above it, and while
   * you're inside its volume you want the terrain underneath. Sampling "the
   * highest surface not above my feet" gets all three right.
   *
   * `probe` widens the footprint test by that much, so a body standing over a
   * crack NARROWER THAN ITSELF is held up by the surfaces either side instead
   * of falling between them. A single centre-point sample cannot do this: it
   * reports the floor of the crack, the controller goes airborne, the wall it
   * was about to step onto stops being a step, and you get shoved back — a
   * juddering oscillation at every seam between two props.
   *
   * Keep `probe` well under the collision radius. Solids taller than a step are
   * pushed out to exactly `radius`, so anything below that can never lift you
   * onto a wall you are merely leaning against.
   */
  groundAt(x, z, fromY = Infinity, out = {}, probe = 0) {
    let bestY = this.terrainHeight(x, z);
    let bestSolid = null;

    for (const s of this.solids) {
      if (s.top > fromY + 0.001) continue;
      if (s instanceof BoxSolid) {
        s.toLocal(x, z, _local);
        if (Math.abs(_local.x) > s.half.x + probe || Math.abs(_local.z) > s.half.z + probe) continue;
      } else {
        const dx = x - s.centre.x, dz = z - s.centre.z;
        const r = s.radius + probe;
        if (dx * dx + dz * dz > r * r) continue;
      }
      if (s.top > bestY) { bestY = s.top; bestSolid = s; }
    }

    out.y = bestY;
    out.solid = bestSolid;
    if (bestSolid) {
      out.normal = out.normal || new THREE.Vector3();
      out.normal.set(0, 1, 0);      // solids are flat-topped by construction
    } else {
      out.normal = this.terrainNormal(x, z, out.normal);
    }
    return out;
  }

  /**
   * Push a vertical capsule out of any solid it is inside.
   * Mutates `pos`. Returns true if anything moved.
   *
   * Resolves along the axis of LEAST penetration, so walking into a crate
   * slides you along its face instead of stopping dead.
   *
   * `stepHeight` is what makes low ledges walkable: any solid whose top is
   * within that of your feet is treated as GROUND, not as a wall, so you walk
   * straight into its footprint and groundAt() lifts you onto it next sample.
   *
   * The alternative — block horizontally, then detect the block and teleport up
   * — cannot work in a capsule world: the push-out leaves you a full radius
   * outside the box, so the probe point is never over the ledge, and at 120Hz
   * you can only close that gap over several frames. It stutters. Classifying
   * low solids as floor up front sidesteps the whole problem.
   *
   * Pass 0 while airborne, so crate walls still block a jump properly.
   */
  resolveHorizontal(pos, radius, height, stepHeight = 0) {
    let moved = false;
    const footY = pos.y;
    const headY = pos.y + height;

    for (const s of this.solids) {
      if (s.bottom > headY || s.top < footY + 0.001) continue;
      if (s.top <= footY + stepHeight) continue;   // a step, not a wall

      if (s instanceof BoxSolid) {
        s.toLocal(pos.x, pos.z, _local);
        const ex = s.half.x + radius, ez = s.half.z + radius;
        const px = ex - Math.abs(_local.x);
        const pz = ez - Math.abs(_local.z);
        if (px <= 0 || pz <= 0) continue;

        if (px < pz) {
          s.toWorldDir(Math.sign(_local.x || 1) * px, 0, _dir);
        } else {
          s.toWorldDir(0, Math.sign(_local.z || 1) * pz, _dir);
        }
        pos.x += _dir.x; pos.z += _dir.z;
        moved = true;
      } else {
        const dx = pos.x - s.centre.x, dz = pos.z - s.centre.z;
        const d = Math.hypot(dx, dz);
        const minD = s.radius + radius;
        if (d >= minD || d < 1e-5) continue;
        const push = (minD - d) / d;
        pos.x += dx * push; pos.z += dz * push;
        moved = true;
      }
    }
    return moved;
  }

  /**
   * Nearest grapple point, scored on HORIZONTAL aim only.
   *
   * This has to ignore the vertical, and that is not a shortcut. The camera's
   * tilt is fixed, so the player has no way to aim upward — and every swing
   * anchor in the game is deliberately overhead. Scoring the full 3D angle made
   * the mast rigging sit right on the edge of the cone (measured dot: 0.34,
   * 0.35, 0.13 against a 0.35 threshold), so throwing at it worked or whiffed
   * essentially at random. Horizontal heading is the only thing the player can
   * actually control, so it is the only thing that should decide the target.
   */
  findGrapplePoint(from, dir, range, coneDot = 0.28) {
    let fx = dir.x, fz = dir.z;
    const fl = Math.hypot(fx, fz);
    if (fl > 1e-4) { fx /= fl; fz /= fl; }

    let best = null, bestScore = Infinity;
    for (const gp of this.grapplePoints) {
      // Bars: latch at the closest point along the segment, so she swings from
      // wherever she grabbed rather than sliding to the middle.
      let px = gp.pos.x, pz = gp.pos.z;
      if (gp.halfLen > 0) {
        const t = clamp(
          (from.x - gp.pos.x) * gp.axisX + (from.z - gp.pos.z) * gp.axisZ,
          -gp.halfLen, gp.halfLen
        );
        px += gp.axisX * t;
        pz += gp.axisZ * t;
      }
      const dx = px - from.x, dy = gp.pos.y - from.y, dz = pz - from.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > range || dist < 0.6) continue;

      const dh = Math.hypot(dx, dz);
      // Near-vertical: there is no heading to face, so stop asking for one.
      const dot = dh < 1.4 ? 1 : (dx * fx + dz * fz) / dh;
      if (dot < coneDot) continue;

      // Prefer anchors that are usefully placed. A swing point above her head
      // is worth reaching for; one level with her feet is usually scenery.
      const lift = clamp01(dy / 5);
      const score = dist * (1.6 - dot) * (1 - lift * 0.4);
      if (score < bestScore) {
        bestScore = score;
        best = gp;
        gp._latch = (gp._latch || new THREE.Vector3()).set(px, gp.pos.y, pz);
      }
    }
    return best;
  }

  /**
   * Build a mesh from the island field. Same height function as collision, so
   * the two can't drift apart.
   */
  buildTerrainMesh(material, { size = 420, segments = 300 } = {}) {
    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);

    const sand = new THREE.Color(0xf6e7b2);
    const grass = new THREE.Color(0x58cd63);
    const rock = new THREE.Color(0x9a8b7a);
    const wet = new THREE.Color(0xdcc896);
    const tmp = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const y = this.terrainHeight(x, z);
      pos.setY(i, y);

      // Vertex-colour banding. Toon shading + colour bands does the work a
      // texture would, at zero download cost, and the bands sit at gameplay-
      // meaningful heights: wet sand at the waterline, grass on the walkable
      // middle, rock on the parts you have to climb.
      //
      // Blended, not switched. Hard thresholds on a 1.4m vertex grid put the
      // boundary wherever the nearest vertex happens to fall, so the shoreline
      // comes out as a visible staircase of 1.4m steps.
      tmp.copy(wet)
        .lerp(sand, smoothstep(clamp01((y - 0.05) / 0.7)))
        .lerp(grass, smoothstep(clamp01((y - 1.1) / 1.1)))
        .lerp(rock, smoothstep(clamp01((y - 8.0) / 3.0)));

      // slope steeper than ~40 degrees goes rocky regardless of height
      const n = this.terrainNormal(x, z);
      if (n.y < 0.80 && y > 0.8) tmp.lerp(rock, smoothstep(clamp01((0.80 - n.y) * 3.4)));

      // A little tonal noise so the big flat plateau isn't one solid fill.
      const tone = 0.90 + fbm(x * 0.11, z * 0.11, 2) * 0.20;
      tmp.multiplyScalar(tone);

      colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, material);
    mesh.receiveShadow = true;
    // NOT a shadow caster. The terrain is far bigger than the shadow camera, so
    // casting from it stamps the shadow frustum's own edge across the island as
    // a hard grey band that slides around as you walk. Props cast; the ground
    // only receives.
    mesh.castShadow = false;
    mesh.name = 'terrain';
    return mesh;
  }
}
