// The test island — "Grog Cay".
//
// This is a locomotion gym dressed as a pirate island. Every piece of it exists
// to exercise one thing in the controller, and it is laid out so you can check
// all of them in about ninety seconds of play:
//
//   the beach           wading in and out, the swim <-> walk handover
//   the stair crates    step-up height, the thing you notice instantly if wrong
//   the gap             jump distance, coyote time at the lip
//   the mast rigging    swing anchors at three heights
//   the wreck           reel anchors, and a roof to land on
//   the lagoon          deep water, diving, the sea floor
//   the spire           a steep face that should make you slide, not climb
//
// If a change to Peggy.js breaks something, it breaks here first and visibly.

import * as THREE from '../../vendor/three/three.module.js';
import { Level, BoxSolid, CylinderSolid } from './Level.js';
import { toonMaterial, addOutline } from '../render/toon.js';
import { PALETTE } from '../player/PeggyModel.js';
import { rand, TAU } from '../core/math.js';

const WOOD = 0x8a6039;
const WOOD_DARK = 0x5d3f24;
const ROPE = 0xc9ab72;
const SAIL = 0xe8dcc0;
const LEAF = 0x3f9e4d;
const LEAF_DARK = 0x2d7539;
const TRUNK = 0x7a5a3a;

export function buildTestIsland(scene) {
  const level = new Level();
  const props = new THREE.Group();
  props.name = 'props';
  scene.add(props);

  const woodMat = toonMaterial({ color: WOOD });
  const woodDarkMat = toonMaterial({ color: WOOD_DARK });
  const ropeMat = toonMaterial({ color: ROPE });
  const sailMat = toonMaterial({ color: SAIL, side: THREE.DoubleSide });
  const goldMat = toonMaterial({ color: PALETTE.gold, rimStrength: 0.85 });
  const metalMat = toonMaterial({ color: PALETTE.metal, rimStrength: 0.9 });
  const leafMat = toonMaterial({ color: LEAF });
  const leafDarkMat = toonMaterial({ color: LEAF_DARK });
  const trunkMat = toonMaterial({ color: TRUNK });

  // ── terrain ──────────────────────────────────────────────────────────────
  // Main island, a smaller one to jump to, and a spire that is deliberately
  // too steep to walk up.
  level
    .addIsland({ cx: 0, cz: 0, radius: 62, height: 11, plateau: 0.34, rough: 0.22 })
    .addIsland({ cx: 78, cz: -26, radius: 30, height: 7.5, plateau: 0.30, rough: 0.26 })
    // The spire is deliberately unwalkable: radius 15 against height 22 puts the
    // face well past the controller's ~52 degree limit, so pushing into it must
    // make you slide back down. If you can walk up this, maxSlope is broken.
    .addIsland({ cx: -46, cz: 52, radius: 15, height: 22, plateau: 0.08, rough: 0.10 })
    .addIsland({ cx: 26, cz: 46, radius: 15, height: 3.2, plateau: 0.45, rough: 0.30 });

  // ── helpers ──────────────────────────────────────────────────────────────

  /** Place a solid AND its mesh together, so they can never disagree. */
  function box(x, y, z, sx, sy, sz, material, rotY = 0, tag = '') {
    const half = new THREE.Vector3(sx / 2, sy / 2, sz / 2);
    const centre = new THREE.Vector3(x, y + sy / 2, z);
    level.addSolid(new BoxSolid(centre, half, rotY, tag));
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
    m.position.copy(centre);
    m.rotation.y = rotY;
    m.castShadow = true;
    m.receiveShadow = true;
    props.add(m);
    return m;
  }

  function cyl(x, y, z, radius, height, material, tag = '') {
    const centre = new THREE.Vector3(x, y + height / 2, z);
    level.addSolid(new CylinderSolid(centre, radius, height / 2, tag));
    const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.08, height, 12), material);
    m.position.copy(centre);
    m.castShadow = true;
    m.receiveShadow = true;
    props.add(m);
    return m;
  }

  const g = (x, z) => level.terrainHeight(x, z);

  /** Surface heights of the stair run, exported so tests can assert on them. */
  const stairTops = [];
  /** Props with an `openAnim(dt)` in userData — ticked every frame. */
  const animated = [];

  /** A visible ring where the hook can latch, so anchors are readable. */
  function anchor(x, y, z, kind = 'swing') {
    level.addGrapplePoint(new THREE.Vector3(x, y, z), { kind });
    const gp = level.grapplePoints[level.grapplePoints.length - 1];
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.30, 0.055, 8, 16), goldMat);
    ring.position.set(x, y, z);
    ring.rotation.x = Math.PI / 2;
    ring.castShadow = true;
    ring.userData.spin = kind === 'swing' ? 1.1 : 0.5;
    ring.userData.baseScale = 1;
    gp.ring = ring;          // so the HUD can highlight whatever is targetable
    props.add(ring);
    return ring;
  }

  // ── the stair crates: step-up test ───────────────────────────────────────
  // Rises of 0.35 / 0.50 / 0.70 m against a stepHeight of 0.52 — so the first
  // two should be walked straight over and the third should require a jump.
  //
  // Each crate is specified by the height of its TOP relative to the previous
  // one, and buried far enough into the sand to sit solid. Specifying tops (not
  // bottoms) is the whole trick: the island surface has close to a metre of
  // noise across this run, so crates placed at a shared base height would give
  // rises of whatever the terrain happened to do, and the test would be
  // measuring the noise rather than the controller.
  {
    const bx = 12, bz = -8;
    const rises = [0.35, 0.50, 0.70];   // vs a stepHeight of 0.52: walk, walk, jump
    const W = 2.0;
    let top = g(bx - W * 0.7, bz);      // the ground you approach from
    stairTops.push(top);
    for (let i = 0; i < rises.length; i++) {
      // Spacing == width, so the crates are FLUSH. Leaving a gap smaller than
      // her body between two solids is a level bug: she stands over the seam,
      // the ground query finds the floor of it, and she judders.
      const x = bx + i * W;
      top += rises[i];
      const bottom = g(x, bz) - 1.0;    // buried, so no crate ever floats
      box(x, bottom, bz, W, top - bottom, 2.2, woodMat, 0, 'crate');
      stairTops.push(top);
    }
    // the big block at the end, to jump down from (and to test coyote time)
    const lastX = bx + rises.length * W + 0.2;
    box(lastX, g(lastX, bz) - 1.0, bz, 2.4, top + 0.9 - (g(lastX, bz) - 1.0), 2.4, woodDarkMat, 0.15);
  }

  // ── the gap: jump distance test ──────────────────────────────────────────
  // A running jump measures 4.44 m at full momentum, so the two gaps are set at
  // 3.4 m (comfortable — clears with room) and 4.2 m (tight — needs full
  // momentum and a clean take-off). Neither is clearable from a standstill.
  // If a movement change moves that 4.44 m number, the second gap is the canary.
  {
    const y = 4.6;
    const zs = [-4, -12.4, -21.6];
    box(-14, y, zs[0], 5, 0.6, 5, woodMat, 0.15);
    box(-14, y, zs[1], 5, 0.6, 5, woodMat, -0.1);
    box(-14, y, zs[2], 6, 0.6, 5, woodDarkMat, 0.05);
    // posts holding them up
    for (const pz of zs) {
      cyl(-14, g(-14, pz), pz, 0.32, y - g(-14, pz), woodDarkMat);
    }
    // an anchor over the tight gap, for players who'd rather swing it
    anchor(-14, y + 5.4, -17.0, 'swing');
  }

  // ── the mast: swing anchors at three heights ─────────────────────────────
  {
    const mx = -4, mz = 18;
    const base = g(mx, mz);
    cyl(mx, base, mz, 0.42, 17, woodMat, 'mast');

    // yardarms
    for (const [h, len] of [[6.5, 9], [11, 7], [14.5, 4.6]]) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, len, 8), woodDarkMat);
      arm.position.set(mx, base + h, mz);
      arm.rotation.z = Math.PI / 2;
      arm.castShadow = true;
      props.add(arm);

      // a sail under the top two
      if (h > 6) {
        const sail = new THREE.Mesh(new THREE.PlaneGeometry(len * 0.82, 3.4), sailMat);
        sail.position.set(mx, base + h - 1.8, mz);
        props.add(sail);
      }
      anchor(mx - len / 2 + 0.5, base + h, mz, 'swing');
      anchor(mx + len / 2 - 0.5, base + h, mz, 'swing');
    }

    // rigging lines, purely visual
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      const pts = [
        new THREE.Vector3(mx, base + 15.5, mz),
        new THREE.Vector3(mx + Math.cos(a) * 6.5, base, mz + Math.sin(a) * 6.5),
      ];
      const line = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.035, pts[0].distanceTo(pts[1]), 5),
        ropeMat
      );
      line.position.lerpVectors(pts[0], pts[1], 0.5);
      line.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        pts[1].clone().sub(pts[0]).normalize()
      );
      props.add(line);
    }
    // crow's nest, reachable only by swinging
    box(mx - 1.1, base + 15.4, mz - 1.1, 2.2, 0.3, 2.2, woodDarkMat);
  }

  // ── the wreck: reel anchors + a roof ─────────────────────────────────────
  {
    const wx = 30, wz = 20;
    const base = g(wx, wz);
    // hull, listing to one side
    const hull = box(wx, base - 0.6, wz, 14, 4.4, 6.2, woodMat, 0.42, 'hull');
    hull.rotation.z = 0.16;
    // deck on top
    box(wx, base + 3.6, wz, 12, 0.5, 5, woodDarkMat, 0.42);
    // a broken mast leaning off it
    const broken = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.42, 11, 10), woodMat);
    broken.position.set(wx + 3, base + 5, wz + 2);
    broken.rotation.set(0.6, 0.3, 0.5);
    broken.castShadow = true;
    props.add(broken);

    // reel anchors: at body height, so they yank you across rather than up
    anchor(wx - 8.5, base + 4.2, wz - 2.0, 'anchor');
    anchor(wx + 7.5, base + 4.6, wz + 2.5, 'anchor');
    anchor(wx, base + 9.5, wz, 'swing');
  }

  // ── palms and rocks, for shade and silhouette ────────────────────────────
  const palmSpots = [
    [-22, -18], [-30, 4], [8, 26], [20, -22], [-8, -28], [34, -4], [-34, -30], [16, 12],
  ];
  for (const [px, pz] of palmSpots) {
    const base = g(px, pz);
    if (base < 1.2) continue;
    const lean = rand(-0.18, 0.18);
    const h = rand(4.5, 7.5);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.34, h, 8), trunkMat);
    trunk.position.set(px, base + h / 2, pz);
    trunk.rotation.z = lean;
    trunk.castShadow = true;
    props.add(trunk);
    level.addSolid(new CylinderSolid(new THREE.Vector3(px, base + h / 2, pz), 0.36, h / 2, 'palm'));

    const crown = new THREE.Group();
    crown.position.set(px + Math.sin(lean) * h * 0.5, base + h, pz);
    const fronds = 9;
    for (let i = 0; i < fronds; i++) {
      const a = (i / fronds) * TAU + rand(-0.2, 0.2);
      const frond = new THREE.Mesh(
        new THREE.SphereGeometry(1.75, 8, 6, 0, Math.PI, 0, Math.PI * 0.5),
        i % 2 ? leafMat : leafDarkMat
      );
      frond.scale.set(1, 0.30, 0.78);
      frond.position.set(Math.cos(a) * 1.1, -0.15, Math.sin(a) * 1.1);
      frond.rotation.set(rand(0.1, 0.4), -a, 0);
      frond.castShadow = true;
      crown.add(frond);
    }
    // coconuts
    for (let i = 0; i < 3; i++) {
      const c = new THREE.Mesh(new THREE.SphereGeometry(0.20, 8, 6), trunkMat);
      c.position.set(rand(-0.3, 0.3), -0.3, rand(-0.3, 0.3));
      crown.add(c);
    }
    props.add(crown);
  }

  // ── barrels and crates: haulables for the hook ───────────────────────────
  const loose = [];
  const barrelSpots = [[6, 4], [7.5, 6], [-10, 10], [24, 14], [-2, -14], [13, -2]];
  for (const [bx, bz] of barrelSpots) {
    const base = g(bx, bz);
    const barrel = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 1.2, 12), woodMat);
    body.castShadow = true;
    barrel.add(body);
    for (const by of [-0.36, 0, 0.36]) {
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.535, 0.045, 6, 14), metalMat);
      hoop.position.y = by;
      hoop.rotation.x = Math.PI / 2;
      barrel.add(hoop);
    }
    barrel.position.set(bx, base + 0.6, bz);
    props.add(barrel);

    const haulable = {
      position: barrel.position,
      object3D: barrel,
      held: false,
      vel: new THREE.Vector3(),
      spin: new THREE.Vector3(),
      radius: 0.55,
      onCaught: () => { haulable.caught = true; },
    };
    level.haulables.push(haulable);
    loose.push(haulable);
  }

  // ── the treasure chest, because it's a pirate game ───────────────────────
  {
    const cx = -46, cz = 52;
    const base = g(cx, cz);
    const chest = new THREE.Group();
    const bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.85, 1.0), woodDarkMat);
    bodyMesh.castShadow = true;
    chest.add(bodyMesh);
    const lid = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.5, 1.5, 12, 1, false, 0, Math.PI),
      woodMat
    );
    lid.rotation.z = Math.PI / 2;
    lid.position.y = 0.42;
    lid.castShadow = true;
    chest.add(lid);
    for (const sx of [-0.55, 0.55]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.9, 1.02), goldMat);
      band.position.set(sx, 0.02, 0);
      chest.add(band);
    }
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.3, 0.12), goldMat);
    lock.position.set(0, 0.05, 0.52);
    chest.add(lock);
    chest.position.set(cx, base + 0.45, cz);
    props.add(chest);
    // Only reachable by climbing the spire island — or by hooking your way up.
    anchor(cx + 3, base + 6, cz + 2, 'swing');

    // OPEN it. The lid hinges back and the gold inside is revealed — the whole
    // point of a context action is that the world visibly answers the tap.
    const loot = new THREE.Group();
    for (let i = 0; i < 14; i++) {
      const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.022, 10), goldMat);
      coin.position.set(rand(-0.45, 0.45), rand(-0.1, 0.12), rand(-0.28, 0.28));
      coin.rotation.set(rand(0, 1), rand(0, 3), rand(-0.5, 0.5));
      loot.add(coin);
    }
    loot.position.set(0, 0.28, 0);
    loot.visible = false;
    chest.add(loot);

    level.addInteractable({
      pos: new THREE.Vector3(cx, base + 0.9, cz),
      radius: 2.8, icon: 'chest', label: 'OPEN',
      onInteract: () => { chest.userData.opening = 1; loot.visible = true; },
    });
    chest.userData.openAnim = (dt) => {
      if (!chest.userData.opening) return;
      lid.rotation.x = Math.max(lid.rotation.x - 3.2 * dt, -2.1);
      loot.position.y = Math.min(loot.position.y + 0.5 * dt, 0.42);
    };
    animated.push(chest);
  }

  // ── the shack: a door, because a door is the clearest context action ─────
  {
    const sx = 18, sz = 14;
    const base = g(sx, sz);
    box(sx, base, sz, 4.4, 3.0, 3.6, woodMat, 0.3);
    // roof
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.6, 1.5, 4), woodDarkMat);
    roof.position.set(sx, base + 3.7, sz);
    roof.rotation.y = 0.3 + Math.PI / 4;
    roof.castShadow = true;
    props.add(roof);

    // the door itself, hinged at one edge so it swings rather than slides
    const hinge = new THREE.Group();
    const dw = 1.0, dh = 2.0;
    const door = new THREE.Mesh(new THREE.BoxGeometry(dw, dh, 0.12), woodDarkMat);
    door.position.x = dw / 2;              // offset so the group's origin IS the hinge
    door.castShadow = true;
    hinge.add(door);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), goldMat);
    knob.position.set(dw - 0.15, 0, 0.1);
    door.add(knob);
    // sit it on the shack's front face, allowing for the 0.3 rad rotation
    const fx = Math.sin(0.3), fz = Math.cos(0.3);
    hinge.position.set(sx + fx * 1.85 - fz * (dw / 2), base + dh / 2, sz + fz * 1.85 + fx * (dw / 2));
    hinge.rotation.y = 0.3;
    props.add(hinge);

    level.addInteractable({
      pos: new THREE.Vector3(sx + fx * 2.4, base + 1.0, sz + fz * 2.4),
      radius: 2.6, icon: 'door', label: 'OPEN',
      onInteract: () => { hinge.userData.opening = 1; },
    });
    hinge.userData.openAnim = (dt) => {
      if (!hinge.userData.opening) return;
      hinge.rotation.y = Math.max(hinge.rotation.y - 3.4 * dt, 0.3 - 2.2);
    };
    animated.push(hinge);
  }

  // ── the ship's wheel on the wreck ────────────────────────────────────────
  {
    const wx = 30, wz = 20;
    const base = g(wx, wz);
    const wheel = new THREE.Group();
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.075, 8, 20), woodMat);
    wheel.add(rim);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 1.55, 6), woodDarkMat);
      spoke.rotation.z = a;
      wheel.add(spoke);
    }
    wheel.position.set(wx - 3.4, base + 5.0, wz - 1.2);
    wheel.rotation.y = 0.42;
    props.add(wheel);

    level.addInteractable({
      pos: wheel.position.clone(),
      radius: 2.4, icon: 'wheel', label: 'TAKE THE HELM', once: false,
      onInteract: () => { wheel.userData.spin = (wheel.userData.spin || 0) + 9; },
    });
    wheel.userData.openAnim = (dt) => {
      if (!wheel.userData.spin) return;
      const s = wheel.userData.spin;
      wheel.rotation.z += s * dt;
      wheel.userData.spin = Math.abs(s) < 0.05 ? 0 : s * Math.pow(0.22, dt);
    };
    animated.push(wheel);
  }

  // ── a dock out over the lagoon: the swim handover ────────────────────────
  {
    const dz = -44;
    for (let i = 0; i < 7; i++) {
      const px = -6 + i * 0;
      const pz = dz + i * 3.0;
      const gy = g(px, pz);
      box(px - 1.6, 1.4, pz, 3.2, 0.34, 2.6, woodMat, 0.02);
      cyl(px - 2.6, Math.max(gy, -6), pz, 0.22, 1.4 - Math.max(gy, -6), woodDarkMat);
      cyl(px - 0.6, Math.max(gy, -6), pz, 0.22, 1.4 - Math.max(gy, -6), woodDarkMat);
    }
    // a lamp post at the end, with a swing ring — the easy way back to shore
    anchor(-1.6, 6.2, dz + 2, 'swing');
  }

  // ── spawn point: on the beach, facing inland ────────────────────────────
  const spawn = new THREE.Vector3(4, 0, -34);
  spawn.y = level.terrainHeight(spawn.x, spawn.z) + 0.2;

  /**
   * Loose props get a deliberately cheap physics: gravity, ground bounce,
   * friction, and they float on water. Not because barrels deserve a rigid body
   * solver, but because a melee swing with NO reaction reads as a broken
   * button — you need something in the world to move when you hit it.
   */
  function updateLoose(dt, water) {
    for (const a of animated) if (a.userData.openAnim) a.userData.openAnim(dt);
    for (const h of loose) {
      if (h.held) continue;
      const moving = h.vel.lengthSq() > 1e-4;
      if (!moving) continue;

      h.vel.y -= 22 * dt;
      h.position.addScaledVector(h.vel, dt);

      const surf = water.heightAt(h.position.x, h.position.z);
      const ground = level.groundAt(h.position.x, h.position.z, Infinity, {}).y;
      const rest = Math.max(ground, surf - 0.15) + h.radius;

      if (h.position.y <= rest) {
        h.position.y = rest;
        // bounce, then settle — a barrel that bounces forever is worse noise
        // than one that thuds and stops
        if (h.vel.y < -1.2) h.vel.y *= -0.32;
        else h.vel.y = 0;
        const fric = Math.pow(surf > ground ? 0.02 : 0.16, dt);  // water drags harder
        h.vel.x *= fric; h.vel.z *= fric;
        if (h.vel.lengthSq() < 0.05) h.vel.set(0, 0, 0);
      }

      // keep them out of solid props
      level.resolveHorizontal(h.position, h.radius, 1.0, 0);
      h.object3D.rotation.x += h.spin.x * dt;
      h.object3D.rotation.z += h.spin.z * dt;
      h.spin.multiplyScalar(Math.pow(0.25, dt));
    }
  }

  /** Shove a loose prop — used by the melee swing. */
  function knock(h, dirX, dirZ, power) {
    h.vel.set(dirX * power, power * 0.45, dirZ * power);
    h.spin.set((Math.random() - 0.5) * 12, 0, (Math.random() - 0.5) * 12);
  }

  return { level, props, spawn, loose, stairTops, updateLoose, knock };
}
