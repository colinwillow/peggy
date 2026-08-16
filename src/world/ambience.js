// Ambience: the world going about its business.
//
// Everything in this file is set dressing that moves — gulls wheeling, a
// phantom trader on the horizon, a fin in the lagoon, fish jumping the swell.
// None of it collides, none of it is interactive, and all of it is built to a
// draw-call budget: the gulls (the only crowd) are three instanced meshes
// TOTAL, posed each frame through a hidden Object3D rig, so a dozen birds
// cost the same as one.
//
// Nothing here casts shadows. A gull at 20m throws a shadow the size of a
// dog, and the shadow map has better things to spend its texels on.

import * as THREE from '../../vendor/three/three.module.js';
import { toonMaterial } from '../render/toon.js';
import { rand, TAU, clamp01, lerp } from '../core/math.js';

// ── gull flocks ─────────────────────────────────────────────────────────────
// Each flock wheels around a fixed point of interest. One circles the mast,
// one works the lagoon, and one rides the thermals over the treasure islet —
// that last one is on the title screen, which is not a coincidence.
const FLOCKS = [
  { cx: 12, cy: 22, cz: -6, r: 11, speed: 0.34, count: 5 },
  { cx: -4, cy: 14, cz: -60, r: 8, speed: -0.42, count: 4 },
  { cx: 2, cy: 12, cz: -100, r: 7, speed: 0.5, count: 4 },
];

// ── fish leap spots ─────────────────────────────────────────────────────────
// Offshore along the routes the player actually travels (and the title orbit
// actually sees), so the sea reads alive where anyone is looking at it.
const FISH_SPOTS = [
  [-14, -48], [0, -66], [10, -78], [-3, -86], [7, -58],
];

export function buildAmbience(scene, water) {
  const group = new THREE.Group();
  group.name = 'ambience';
  scene.add(group);

  const updaters = [];

  // ── gulls ─────────────────────────────────────────────────────────────────
  {
    const total = FLOCKS.reduce((n, f) => n + f.count, 0);

    const bodyGeo = new THREE.SphereGeometry(0.20, 7, 5);
    bodyGeo.scale(2.1, 0.62, 0.85);          // an egg on its side, beak-end first
    const wingGeo = (side) => {
      const g = new THREE.PlaneGeometry(1.05, 0.34, 2, 1);
      g.translate(side * 0.55, 0, 0);        // pivot at the wing root
      return g;
    };
    const bodyMat = toonMaterial({ color: 0xf4f2ea, rimStrength: 0.25 });
    const wingMat = toonMaterial({ color: 0xe8e4d8, rimStrength: 0.2, side: THREE.DoubleSide });

    const bodies = new THREE.InstancedMesh(bodyGeo, bodyMat, total);
    const wingsR = new THREE.InstancedMesh(wingGeo(+1), wingMat, total);
    const wingsL = new THREE.InstancedMesh(wingGeo(-1), wingMat, total);
    for (const m of [bodies, wingsR, wingsL]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.castShadow = false;
      m.frustumCulled = false;               // they cross cells constantly; skip the churn
      group.add(m);
    }

    // The invisible rig: real scene-graph nodes so the wing pivots compose
    // correctly, but never added to the scene — only their matrices are read.
    const rigs = [];
    for (const flock of FLOCKS) {
      for (let i = 0; i < flock.count; i++) {
        const root = new THREE.Object3D();
        const wr = new THREE.Object3D();
        const wl = new THREE.Object3D();
        wr.position.set(0.08, 0.05, 0);
        wl.position.set(-0.08, 0.05, 0);
        root.add(wr, wl);
        rigs.push({
          flock, root, wr, wl,
          phase: (i / flock.count) * TAU + rand(0, 0.7),
          flap: rand(2.4, 3.4),              // wingbeats per second, per bird
          flapPhase: rand(0, TAU),
          bob: rand(0.6, 1.4),
        });
      }
    }

    updaters.push((dt, t) => {
      for (let i = 0; i < rigs.length; i++) {
        const b = rigs[i];
        const f = b.flock;
        const a = b.phase + t * f.speed;
        const dir = Math.sign(f.speed);
        b.root.position.set(
          f.cx + Math.cos(a) * f.r,
          f.cy + Math.sin(t * 0.7 + b.phase * 3) * b.bob,
          f.cz + Math.sin(a) * f.r
        );
        // face along the tangent of the circle
        b.root.rotation.y = Math.atan2(-Math.sin(a) * dir, Math.cos(a) * dir);
        // bank into the turn
        b.root.rotation.z = -0.28 * dir;

        // Flap in bursts, glide between them — the glide is what makes them
        // read as gulls rather than bats. The burst gate is a slow sine per
        // bird, so the flock never synchronises.
        // The resting dihedral (+0.24) matters more than it looks: a flat
        // wing seen edge-on is a line, and a gliding gull vanished into a
        // floating plank. Kept slightly raised, there is always some wing
        // face toward the camera.
        const gliding = Math.sin(t * 0.5 + b.phase * 5) > 0.35;
        const amp = gliding ? 0.06 : 0.75;
        const flap = Math.sin(t * b.flap * TAU * 0.5 + b.flapPhase) * amp + 0.24;
        b.wl.rotation.z = flap;
        b.wr.rotation.z = -flap;

        b.root.updateMatrixWorld(true);
        bodies.setMatrixAt(i, b.root.matrixWorld);
        wingsR.setMatrixAt(i, b.wr.matrixWorld);
        wingsL.setMatrixAt(i, b.wl.matrixWorld);
      }
      bodies.instanceMatrix.needsUpdate = true;
      wingsR.instanceMatrix.needsUpdate = true;
      wingsL.instanceMatrix.needsUpdate = true;
    });
  }

  // ── the phantom trader ────────────────────────────────────────────────────
  // A square-rigger forever crossing the horizon, half-lost in the haze. She
  // never arrives and never leaves; she is scenery with a schedule. Radius
  // chosen so the exp2 fog eats about a quarter of her — present enough to
  // spot, far enough to stay a silhouette.
  {
    const hullMat = toonMaterial({ color: 0x232f40, rimStrength: 0.15 });
    const sailMat = toonMaterial({ color: 0xd9d2bd, rimStrength: 0.1, side: THREE.DoubleSide });

    const ship = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(18, 3.4, 4.6), hullMat);
    hull.position.y = 1.1;
    const stern = new THREE.Mesh(new THREE.BoxGeometry(4.4, 2.2, 4.2), hullMat);
    stern.position.set(-7.4, 3.6, 0);
    ship.add(hull, stern);
    for (const [mx, mh, sw] of [[4.5, 15, 7.5], [-2.5, 17, 8.5]]) {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, mh, 5), hullMat);
      mast.position.set(mx, 2.5 + mh / 2, 0);
      ship.add(mast);
      for (const [sy, k] of [[0.72, 1], [0.45, 0.8]]) {
        const sail = new THREE.Mesh(new THREE.PlaneGeometry(sw * k, mh * 0.30), sailMat);
        sail.position.set(mx, 2.5 + mh * sy, 0);
        sail.rotation.y = Math.PI / 2;
        ship.add(sail);
      }
    }
    for (const m of ship.children) { m.castShadow = false; m.receiveShadow = false; }
    ship.scale.setScalar(1.35);                  // she reads at distance, not up close
    group.add(ship);

    const CX = 0, CZ = -30, R = 170, W = 0.021;  // one lap in about five minutes
    updaters.push((dt, t) => {
      const a = t * W;
      ship.position.set(CX + Math.cos(a) * R, 0, CZ + Math.sin(a) * R);
      ship.rotation.y = -a;                      // bow along the tangent
      ship.rotation.z = Math.sin(t * 0.5) * 0.02; // the long slow roll of a swell
    });
  }

  // ── the fin ───────────────────────────────────────────────────────────────
  // Something patrols the lagoon. It surfaces, carves a slow circle, and
  // slides under again. It has no gameplay whatsoever, which is exactly what
  // makes people stop swimming to watch it.
  {
    const finGeo = new THREE.ConeGeometry(0.55, 1.15, 6);
    finGeo.scale(0.32, 1, 1);                    // a blade, not a party hat
    const fin = new THREE.Mesh(finGeo, toonMaterial({ color: 0x39505e, rimStrength: 0.2 }));
    fin.castShadow = false;
    group.add(fin);

    // West of the pillar course, in open sea — the first patrol circle sat on
    // the archipelago line and the fin ghosted straight through the pillars.
    const CX = -15, CZ = -64, R = 5.5, W = 0.42;
    updaters.push((dt, t) => {
      const a = t * W;
      const x = CX + Math.cos(a) * R;
      const z = CZ + Math.sin(a) * R;
      // surfaced for a while, then a long quiet dive
      const cycle = Math.sin(t * 0.11);
      const up = clamp01((cycle - 0.05) * 6);
      fin.position.set(x, water.heightAt(x, z) + lerp(-1.6, 0.28, up), z);
      fin.rotation.y = Math.atan2(-Math.sin(a), Math.cos(a));
      fin.rotation.z = -0.12;                    // heeled into the turn
    });
  }

  // ── leaping fish ──────────────────────────────────────────────────────────
  // Little silver commas popping out of the swell. Each fish rests hidden
  // under water, waits out its own timer, then takes a 0.8s parabolic hop at
  // one of the fixed offshore spots.
  {
    const fishGeo = new THREE.CapsuleGeometry(0.09, 0.30, 3, 6);
    fishGeo.rotateX(Math.PI / 2);                // long axis along +z = travel
    const fishMat = toonMaterial({ color: 0x9fd8d2, rimStrength: 0.5, rimColor: 0xffffff });
    const fishes = [];
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(fishGeo, fishMat);
      m.castShadow = false;
      m.visible = false;
      group.add(m);
      fishes.push({ m, wait: rand(1, 6), t: -1, from: new THREE.Vector3(), dir: 0 });
    }
    const HOP_T = 0.8, HOP_H = 1.5, HOP_D = 2.6;

    updaters.push((dt, t) => {
      for (const f of fishes) {
        if (f.t < 0) {
          f.wait -= dt;
          if (f.wait <= 0) {
            const [sx, sz] = FISH_SPOTS[(Math.random() * FISH_SPOTS.length) | 0];
            f.from.set(sx + rand(-2, 2), 0, sz + rand(-2, 2));
            f.dir = rand(0, TAU);
            f.t = 0;
            f.m.visible = true;
          }
          continue;
        }
        f.t += dt;
        const p = f.t / HOP_T;
        if (p >= 1) {
          f.t = -1;
          f.wait = rand(2, 8);
          f.m.visible = false;
          continue;
        }
        const dx = Math.sin(f.dir), dz = Math.cos(f.dir);
        const x = f.from.x + dx * HOP_D * p;
        const z = f.from.z + dz * HOP_D * p;
        const surf = water.heightAt(x, z);
        f.m.position.set(x, surf + Math.sin(p * Math.PI) * HOP_H - 0.15, z);
        f.m.rotation.y = f.dir;
        // nose follows the arc: up on the way out, down on the way in
        f.m.rotation.x = lerp(-0.9, 0.9, p);
      }
    });
  }

  return {
    update(dt, time) {
      for (const u of updaters) u(dt, time);
    },
  };
}
