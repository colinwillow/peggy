// THE MAROON NEBULA — the space-pirate world.
//
// Same bones as the test island (heightfield islands in a sea, solids, hook
// anchors, loose casks, crabs, coins), wearing a different sky: the "sea" is
// a stardust lagoon, the islands are alien planetoids, the palms are
// tentacle-trees, the galleon FLIES, and the horizon is a ringed gas giant
// over a field of stars. Everything the controller can do on the island it
// can do here — this file only changes what the doing looks like.
//
// Layout, reading south from spawn:
//
//   the beach          lavender sand, glow-reeds, casks, crabs
//   the cargo crates   the step-up stair, because it always rides along
//   THE SKYWAY         floating rock slabs over the void-sea: 4 / 6 / 8m
//                      gaps, then a 16m double-jump finale onto the
//                      floating treasure isle
//   the spar line      monkey-bar hook route west, delivering onto the
//   the sky-galleon    hovering pirate ship — deck, helm, chest, anchors
//   the crystal spire  too steep to walk, pretty to slide down
//   the mushroom atoll giant caps you can jump on
//
// Loaded when the URL has no ?world=island. The island keeps every test;
// this world keeps the players.

import * as THREE from '../../vendor/three/three.module.js';
import { Level, BoxSolid, CylinderSolid } from './Level.js';
import { Crab } from './Crab.js';
import { toonMaterial } from '../render/toon.js';
import { PALETTE } from '../player/PeggyModel.js';
import { rand, TAU } from '../core/math.js';

// The palette: bruised purples and teals with gold and hot magenta accents,
// so the doubloons and the ink still read at a glance.
const ROCK = 0x6b5591;
const ROCK_DARK = 0x4a3a6b;
const WOOD = 0x9a68b8;         // "wood" grown on an alien world
const WOOD_DARK = 0x6b4a8e;
const SAIL = 0xe8d9f2;
const TEAL = 0x3fd8c2;
const GLOW_CYAN = 0x7df5e3;
const GLOW_MAGENTA = 0xf25ed3;
const GLOW_CORAL = 0xff8f6b;

export function buildNebulaWorld(scene) {
  const level = new Level();
  const props = new THREE.Group();
  props.name = 'props';
  scene.add(props);

  const rockMat = toonMaterial({ color: ROCK, rimStrength: 0.35, rimColor: 0xc9a8f0 });
  const rockDarkMat = toonMaterial({ color: ROCK_DARK, rimStrength: 0.3 });
  const woodMat = toonMaterial({ color: WOOD });
  const woodDarkMat = toonMaterial({ color: WOOD_DARK });
  const sailMat = toonMaterial({ color: SAIL, side: THREE.DoubleSide });
  const goldMat = toonMaterial({ color: PALETTE.gold, rimStrength: 0.85 });
  const tealMat = toonMaterial({ color: TEAL });
  const capMat = toonMaterial({ color: 0xb08ad6, rimStrength: 0.3 });
  // Glow things are UNLIT on purpose: in a dim world, a MeshBasicMaterial IS
  // a light source to the eye, at zero lighting cost.
  const glowCyanMat = new THREE.MeshBasicMaterial({ color: GLOW_CYAN });
  const glowMagentaMat = new THREE.MeshBasicMaterial({ color: GLOW_MAGENTA });
  const glowCoralMat = new THREE.MeshBasicMaterial({ color: GLOW_CORAL });

  // ── terrain: three planetoids and a spire ────────────────────────────────
  level
    .addIsland({ cx: 0, cz: 0, radius: 58, height: 12, plateau: 0.32, rough: 0.26 })
    .addIsland({ cx: 76, cz: -30, radius: 26, height: 8, plateau: 0.30, rough: 0.28 })
    // the crystal spire: same unwalkable steepness as the island's — you
    // slide down it in a shower of sparkle, you do not climb it
    .addIsland({ cx: -48, cz: 46, radius: 15, height: 22, plateau: 0.08, rough: 0.10 })
    .addIsland({ cx: 30, cz: 44, radius: 14, height: 3.2, plateau: 0.45, rough: 0.30 });

  // ── helpers (place solid + mesh together, always) ────────────────────────
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

  const g = (x, z) => level.terrainHeight(x, z);

  const stairTops = [];
  const animated = [];
  const coins = [];
  const coinGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.06, 14);
  const coinMat = toonMaterial({ color: 0xf3c14b, rimStrength: 1.0, rimColor: 0xfff2c0 });

  function addCoin(x, y, z) {
    const c = new THREE.Mesh(coinGeo, coinMat);
    c.position.set(x, y, z);
    c.rotation.z = Math.PI / 2;
    c.rotation.y = rand(0, TAU);
    c.castShadow = true;
    c.userData.coin = true;
    c.userData.baseY = y;
    const phase = rand(0, TAU);
    c.userData.openAnim = (dt) => {
      if (c.userData.collected) return;
      c.rotation.y += 2.6 * dt;
      c.userData.t = (c.userData.t || phase) + dt;
      c.position.y = c.userData.baseY + Math.sin(c.userData.t * 2.2) * 0.12;
    };
    animated.push(c);
    props.add(c);
    coins.push(c);
    return c;
  }

  function anchor(x, y, z, kind = 'swing') {
    level.addGrapplePoint(new THREE.Vector3(x, y, z), { kind });
    const gp = level.grapplePoints[level.grapplePoints.length - 1];
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.30, 0.055, 8, 16), goldMat);
    ring.position.set(x, y, z);
    ring.rotation.x = Math.PI / 2;
    ring.castShadow = true;
    ring.userData.spin = kind === 'swing' ? 1.1 : 0.5;
    ring.userData.baseScale = 1;
    gp.ring = ring;
    props.add(ring);
    return ring;
  }

  /** A pulsing crystal shard — the world's plant life and its lamps. */
  function crystal(x, y, z, r, mat, tilt = 0.4) {
    const c = new THREE.Mesh(new THREE.OctahedronGeometry(r, 0), mat);
    c.position.set(x, y + r * 0.8, z);
    c.rotation.set(rand(-tilt, tilt), rand(0, TAU), rand(-tilt, tilt));
    c.castShadow = true;
    props.add(c);
    return c;
  }

  function crystalCluster(x, z, big = 0.9) {
    const y = g(x, z);
    crystal(x, y, z, big, glowMagentaMat);
    crystal(x + rand(0.5, 0.9), y, z + rand(-0.4, 0.4), big * 0.55, glowCyanMat);
    crystal(x - rand(0.4, 0.8), y, z + rand(0.3, 0.7), big * 0.4, glowCyanMat);
  }

  /**
   * A tentacle-tree: this world's palm. A curling stack of cones that leans
   * like an octopus arm reaching out of the ground, sucker-discs down the
   * inner curve, one glow-bulb at the tip.
   */
  function tentacleTree(px, pz, height = 5.2, lean = 0.55) {
    const base = g(px, pz);
    const grp = new THREE.Group();
    const segs = 7;
    const dir = rand(0, TAU);
    let x = 0, y = 0, z = 0, bend = 0;
    for (let i = 0; i < segs; i++) {
      const t = i / (segs - 1);
      const segLen = (height / segs) * (1 - t * 0.25);
      const r = 0.5 * (1 - t * 0.82) + 0.06;
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(r * (1 - 0.16), r, segLen * 1.15, 8), woodMat);
      bend = t * t * lean * 2.2;
      seg.position.set(x + Math.sin(dir) * bend * 0.5, base + y + segLen / 2, z + Math.cos(dir) * bend * 0.5);
      seg.rotation.z = Math.sin(dir) * bend * 0.5;
      seg.rotation.x = -Math.cos(dir) * bend * 0.5;
      seg.castShadow = true;
      grp.add(seg);
      // sucker-discs on the inner curve of the upper half
      if (i >= 3) {
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, 0.05, 8), tealMat);
        disc.position.copy(seg.position);
        disc.position.y += segLen * 0.1;
        disc.position.x -= Math.sin(dir) * r * 0.9;
        disc.position.z -= Math.cos(dir) * r * 0.9;
        disc.rotation.z = Math.PI / 2 * Math.sin(dir);
        disc.rotation.x = Math.PI / 2 * Math.cos(dir);
        grp.add(disc);
      }
      x += Math.sin(dir) * bend;
      z += Math.cos(dir) * bend;
      y += segLen * 0.92;
    }
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), glowCoralMat);
    bulb.position.set(x, base + y + 0.15, z);
    grp.add(bulb);
    grp.position.set(px, 0, pz);
    props.add(grp);
    return grp;
  }

  /** A giant mushroom. Big ones get a solid cap you can stand on. */
  function mushroom(px, pz, capR = 1.6, height = 2.2, walkable = false) {
    const base = g(px, pz);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(capR * 0.28, capR * 0.42, height, 10), toonMaterial({ color: 0xe8ddf0 }));
    stem.position.set(px, base + height / 2, pz);
    stem.castShadow = true;
    props.add(stem);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(capR, 14, 10, 0, TAU, 0, Math.PI * 0.5), capMat);
    cap.position.set(px, base + height, pz);
    cap.scale.y = 0.55;
    cap.castShadow = true;
    props.add(cap);
    for (let i = 0; i < 5; i++) {
      const a = rand(0, TAU), f = rand(0.3, 0.75);
      // sit each spot ON the squashed dome: local height = sqrt(1-f^2) * r * squash
      const spot = new THREE.Mesh(new THREE.CylinderGeometry(capR * 0.14, capR * 0.14, 0.05, 8), glowCyanMat);
      spot.position.set(
        px + Math.cos(a) * f * capR,
        base + height + Math.sqrt(1 - f * f) * capR * 0.55 - 0.01,
        pz + Math.sin(a) * f * capR
      );
      props.add(spot);
    }
    if (walkable) {
      level.addSolid(new CylinderSolid(new THREE.Vector3(px, base + height - 0.35, pz), capR * 0.9, 0.35, 'mushroom'));
    }
  }

  function glowReeds(px, pz, n = 5) {
    const base = g(px, pz);
    for (let i = 0; i < n; i++) {
      const x = px + rand(-1.2, 1.2), z = pz + rand(-1.2, 1.2);
      const h = rand(0.9, 1.7);
      const reed = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, h, 5), tealMat);
      reed.position.set(x, base + h / 2, z);
      reed.rotation.set(rand(-0.12, 0.12), 0, rand(-0.12, 0.12));
      props.add(reed);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.085, 6, 5), glowCyanMat);
      tip.position.set(x + reed.rotation.z * -h, base + h + 0.05, z + reed.rotation.x * h);
      props.add(tip);
    }
  }

  // ── flora across the planetoids ──────────────────────────────────────────
  for (const [px, pz] of [[-22, -16], [-30, 6], [9, 24], [20, -22], [-8, -27], [33, -6], [-33, -28], [15, 12]]) {
    tentacleTree(px, pz, rand(4.4, 6.2), rand(0.4, 0.7));
  }
  for (const [px, pz] of [[-14, 20], [22, 8], [4, -18], [-26, -6], [78, -26], [70, -38]]) crystalCluster(px, pz);
  for (const [px, pz] of [[6, -33], [-12, -30], [-28, -18], [26, -18], [70, -22]]) glowReeds(px, pz);

  // the mushroom atoll: the big caps are platforms
  mushroom(28, 42, 2.6, 3.4, true);
  mushroom(33, 47, 2.0, 2.4, true);
  mushroom(24, 48, 1.5, 1.8);
  mushroom(36, 41, 1.2, 1.5);
  for (let i = 0; i < 6; i++) addCoin(28 + Math.cos(i) * 4, g(28, 44) + 5.4, 44 + Math.sin(i) * 3);

  // the second planetoid: quieter, a lookout with loot
  tentacleTree(76, -24, 6.5, 0.7);
  tentacleTree(70, -34, 4.8, 0.5);
  for (let i = 0; i < 5; i++) addCoin(76 + Math.cos(i * 1.3) * 3, g(76, -30) + 1.0, -30 + Math.sin(i * 1.3) * 3);

  // the crystal spire wears its namesake
  {
    const top = g(-48, 46);
    crystal(-48, top - 1.2, 46, 4.2, glowMagentaMat, 0.15);
    crystal(-45.5, g(-45.5, 44) - 0.4, 44, 1.4, glowCyanMat);
    crystal(-50.5, g(-50.5, 48.5) - 0.4, 48.5, 1.1, glowCyanMat);
  }

  // ── the cargo crates: the step-up stair rides along ──────────────────────
  {
    const bx = 12, bz = -8;
    const rises = [0.35, 0.50, 0.70];
    const W = 2.0;
    let top = g(bx - W * 0.7, bz);
    stairTops.push(top);
    for (let i = 0; i < rises.length; i++) {
      const x = bx + i * W;
      top += rises[i];
      const bottom = g(x, bz) - 1.0;
      box(x, bottom, bz, W, top - bottom, 2.2, woodDarkMat, 0, 'crate');
      stairTops.push(top);
    }
    const lastX = bx + rises.length * W + 0.2;
    box(lastX, g(lastX, bz) - 1.0, bz, 2.4, top + 0.9 - (g(lastX, bz) - 1.0), 2.4, woodMat, 0.15);
  }

  // ── THE SKYWAY: floating rock slabs over the void-sea ────────────────────
  // The archipelago, translated into this world's language: instead of sea
  // stacks the slabs HOVER, crystals burning underneath. Gaps 4 / 6 / 8m
  // escalate to a 16m finale that honestly needs the double jump; falling
  // short is a splash into stardust and a swim back.
  /** A floating slab: walkable cap, rock underside, hover-crystals below. */
  function floatSlab(px, pz, topY, R) {
    const thick = 1.3;
    level.addSolid(new CylinderSolid(new THREE.Vector3(px, topY - thick / 2, pz), R, thick / 2, 'float'));
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 0.82, thick, 9), rockMat);
    cap.position.set(px, topY - thick / 2, pz);
    cap.castShadow = true;
    cap.receiveShadow = true;
    props.add(cap);
    const keel = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.8, 0.12, R * 1.15, 9), rockDarkMat);
    keel.position.set(px, topY - thick - R * 0.55, pz);
    keel.castShadow = true;
    props.add(keel);
    const shard = new THREE.Mesh(new THREE.OctahedronGeometry(R * 0.24, 0), glowCyanMat);
    shard.position.set(px, topY - thick - R * 0.62, pz);
    shard.userData.openAnim = (dt) => { shard.rotation.y += 0.9 * dt; };
    animated.push(shard);
    props.add(shard);
  }

  {
    const R = 2.0;
    // [x, z, top] — edge gaps 4, 6, 8, then 16.2 to the treasure isle's rim.
    const hops = [
      [-4.0, -55.0, 2.6],
      [-3.0, -62.9, 3.2],
      [-1.0, -72.7, 3.8],
      [1.5, -84.4, 4.4],
    ];
    for (const [px, pz, top] of hops) {
      floatSlab(px, pz, top, R);
      addCoin(px, top + 0.9, pz);
    }

    // the floating treasure isle
    const ix = 3.5, iz = -109, itop = 5.2, iR = 6.5;
    floatSlab(ix, iz, itop, iR);
    // (a tentacle-tree can't grow on a floating rock — its base samples the
    // terrain — so the isle gets crystals and the chest instead)
    crystal(ix - 3.2, itop, iz + 1.5, 1.5, glowMagentaMat);
    crystal(ix + 2.8, itop, iz - 2.0, 1.0, glowCyanMat);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      addCoin(ix + Math.cos(a) * 2.6, itop + 0.7, iz + Math.sin(a) * 2.6);
    }
    buildChest(ix, itop, iz, () => {
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU;
        addCoin(ix + Math.cos(a) * rand(1.2, 3.4), itop + 0.8, iz + Math.sin(a) * rand(1.2, 3.4));
      }
    });
    anchor(ix, itop + 7.5, iz, 'swing');
  }

  // ── THE SKY-GALLEON: a pirate ship that flies ────────────────────────────
  // Hovers off the west coast at deck height 6.5, glow-keel burning under
  // the hull. The spar line (below) is the way aboard; the helm and a chest
  // are the reasons to come. Solids under the deck so it is a real place.
  const GALLEON = { x: -68, z: -6, deck: 6.5 };
  {
    const { x, z, deck } = GALLEON;
    // deck + hull: one walkable box, two tapering hull boxes below it
    box(x, deck - 0.5, z, 13.0, 0.5, 4.6, woodMat, 0.12, 'deck');
    const hull1 = new THREE.Mesh(new THREE.BoxGeometry(12.2, 1.6, 4.0), woodDarkMat);
    hull1.position.set(x, deck - 1.4, z);
    hull1.rotation.y = 0.12;
    hull1.castShadow = true;
    props.add(hull1);
    const hull2 = new THREE.Mesh(new THREE.BoxGeometry(10.0, 1.2, 3.0), woodMat);
    hull2.position.set(x, deck - 2.5, z);
    hull2.rotation.y = 0.12;
    props.add(hull2);
    // the glow-keel: the thing that makes it fly, and the thing that says so —
    // wider than the hull above it, so it shows from the side, not just below
    const keel = new THREE.Mesh(new THREE.BoxGeometry(9.4, 0.4, 3.6), glowCyanMat);
    keel.position.set(x, deck - 3.25, z);
    keel.rotation.y = 0.12;
    props.add(keel);
    // a prow: the hull comes to a point instead of ending in a wall
    const prow = new THREE.Mesh(new THREE.ConeGeometry(1.9, 3.4, 4), woodDarkMat);
    prow.position.set(x + 7.4, deck - 1.4, z - 0.85);
    prow.rotation.z = -Math.PI / 2;
    prow.rotation.x = Math.PI / 4;
    prow.rotation.y = 0.12;
    prow.castShadow = true;
    props.add(prow);
    // stern castle
    box(x - 4.6, deck, z - 0.2, 3.2, 1.6, 4.0, woodDarkMat, 0.12, 'stern');
    // masts, yards, sails
    for (const [mx, mh] of [[x + 2.2, 11], [x - 2.4, 9]]) {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, mh, 8), woodDarkMat);
      mast.position.set(mx, deck + mh / 2, z);
      mast.castShadow = true;
      props.add(mast);
      const yard = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 4.6, 6), woodDarkMat);
      yard.position.set(mx, deck + mh * 0.72, z);
      yard.rotation.z = Math.PI / 2;
      yard.rotation.y = 0.12;
      props.add(yard);
      // square-rigged: the sail hangs from the yard ACROSS the ship, so its
      // face looks fore-and-aft — along the hull, not out the sides
      const sail = new THREE.Mesh(new THREE.PlaneGeometry(4.2, mh * 0.42), sailMat);
      sail.position.set(mx + 0.15, deck + mh * 0.5, z);
      sail.rotation.y = Math.PI / 2 + 0.12;
      props.add(sail);
      anchor(mx, deck + mh * 0.72, z, 'swing');
    }
    // lanterns at bow and stern
    for (const lx of [x + 6.2, x - 6.0]) {
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), glowCoralMat);
      lamp.position.set(lx, deck + 1.2, z + (lx > x ? 0.8 : -0.4));
      props.add(lamp);
    }
    // the helm: a wheel you can actually spin
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.07, 8, 14), goldMat);
    wheel.position.set(x - 3.4, deck + 2.4, z - 0.2);
    wheel.rotation.y = Math.PI / 2 + 0.12;
    wheel.castShadow = true;
    props.add(wheel);
    for (let i = 0; i < 4; i++) {
      const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.35, 6), woodDarkMat);
      spoke.rotation.z = (i / 4) * Math.PI;
      wheel.add(spoke);
    }
    level.addInteractable({
      pos: wheel.position.clone(), radius: 2.4, icon: 'wheel', label: 'SPIN', once: false,
      onInteract: () => { wheel.userData.spinT = 1.4; return false; },
    });
    wheel.userData.openAnim = (dt) => {
      if (wheel.userData.spinT > 0) {
        wheel.userData.spinT -= dt;
        wheel.rotation.x += dt * 9 * wheel.userData.spinT;
      }
    };
    animated.push(wheel);
    // the captain's chest, tucked against the stern castle
    buildChest(x - 2.2, deck, z + 1.4, () => {
      for (let i = 0; i < 8; i++) addCoin(x + rand(-4, 4), deck + 0.8, z + rand(-1.4, 1.4));
    });
    anchor(x + 6.6, deck + 3.4, z + 0.6, 'anchor');
  }

  // ── THE SPAR LINE: the monkey-bar hook route to the galleon ──────────────
  {
    const barY = 7.2;
    const bars = [
      [-34, -30], [-42, -26], [-50, -21], [-58, -16], [-64, -10],
    ];
    for (let i = 0; i < bars.length; i++) {
      const [bx, bz] = bars[i];
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 3.4, 8), woodDarkMat);
      bar.position.set(bx, barY, bz);
      bar.rotation.z = Math.PI / 2;
      bar.castShadow = true;
      props.add(bar);
      for (const e of [-1.7, 1.7]) {
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), goldMat);
        cap.position.set(bx + e, barY, bz);
        props.add(cap);
        // no pilings — these spars FLOAT, held by a shard of the same stuff
        // that keeps the slabs up
      }
      const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.3, 0), glowCyanMat);
      shard.position.set(bx, barY - 0.9, bz);
      shard.userData.openAnim = (dt) => { shard.rotation.y += 1.3 * dt; };
      animated.push(shard);
      props.add(shard);
      level.addGrapplePoint(new THREE.Vector3(bx, barY, bz), {
        kind: 'swing', axisX: 1, axisZ: 0, halfLen: 1.7,
      });
      if (i < bars.length - 1) {
        const [nx, nz] = bars[i + 1];
        addCoin((bx + nx) / 2, barY - 3.6, (bz + nz) / 2);
      }
    }
  }

  // ── background floaters: depth for the middle distance ───────────────────
  // Pure decor — no solids — so they can never snag a jump or a shot.
  for (const [fx, fy, fz, fr] of [
    [-30, 14, -70, 2.6], [40, 18, -60, 3.4], [-80, 22, 30, 4.0],
    [90, 16, 20, 2.2], [20, 26, -110, 3.0], [-60, 12, -50, 1.8],
  ]) {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(fr, 0), rockDarkMat);
    rock.position.set(fx, fy, fz);
    rock.rotation.set(rand(0, TAU), rand(0, TAU), 0);
    props.add(rock);
    const shard = new THREE.Mesh(new THREE.OctahedronGeometry(fr * 0.3, 0), glowMagentaMat);
    shard.position.set(fx, fy - fr - 0.6, fz);
    props.add(shard);
  }

  // ── the sky itself: stars, gas giant, moon, nebula wisps ─────────────────
  {
    // stars: one Points cloud on the upper dome, unfogged, constant size
    const N = 1500;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const tints = [
      new THREE.Color(0xffffff), new THREE.Color(0xffffff), new THREE.Color(0xbfe8ff),
      new THREE.Color(0xffd9f0), new THREE.Color(0xfff0b8),
    ];
    for (let i = 0; i < N; i++) {
      // points on a sphere, biased upward so few stars drown at the horizon
      const u = rand(-0.15, 1), a = rand(0, TAU);
      const y = Math.max(u, 0.02);
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const R = 860;
      pos[i * 3] = Math.cos(a) * r * R;
      pos[i * 3 + 1] = y * R;
      pos[i * 3 + 2] = Math.sin(a) * r * R;
      const t = tints[(Math.random() * tints.length) | 0];
      col[i * 3] = t.r; col[i * 3 + 1] = t.g; col[i * 3 + 2] = t.b;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
      size: 2.1, sizeAttenuation: false, vertexColors: true,
      transparent: true, opacity: 0.9, fog: false, depthWrite: false,
    }));
    stars.frustumCulled = false;
    scene.add(stars);

    // the gas giant: flat-banded, ringed, enormous, unfogged
    const planet = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(55, 28, 20), new THREE.MeshBasicMaterial({ color: 0xd98e5f, fog: false }));
    planet.add(body);
    for (const [by, bc, br] of [[-14, 0xb56a48, 53.5], [6, 0xc77a52, 54.2], [24, 0xb56a48, 50]]) {
      const band = new THREE.Mesh(new THREE.SphereGeometry(br, 24, 6), new THREE.MeshBasicMaterial({ color: bc, fog: false }));
      band.scale.y = 0.10;
      band.position.y = by;
      planet.add(band);
    }
    const ring = new THREE.Mesh(new THREE.RingGeometry(68, 96, 40), new THREE.MeshBasicMaterial({
      color: 0xf0d8a8, fog: false, side: THREE.DoubleSide, transparent: true, opacity: 0.8,
    }));
    ring.rotation.x = Math.PI / 2 - 0.35;
    planet.add(ring);
    planet.position.set(300, 120, -520);
    planet.rotation.z = -0.12;
    scene.add(planet);

    // a small chalky moon on the other flank
    const moon = new THREE.Mesh(new THREE.SphereGeometry(16, 18, 14), new THREE.MeshBasicMaterial({ color: 0xcdd6e8, fog: false }));
    moon.position.set(-420, 190, -260);
    scene.add(moon);

    // nebula wisps: huge soft sprites from a runtime radial-gradient texture
    const cnv = document.createElement('canvas');
    cnv.width = cnv.height = 128;
    const ctx = cnv.getContext('2d');
    const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.45, 'rgba(255,255,255,0.32)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    const wispTex = new THREE.CanvasTexture(cnv);
    for (const [wx, wy, wz, ws, wc, wo] of [
      [-520, 210, -640, 640, 0xc86bf0, 0.17],
      [560, 150, -560, 520, 0x4be8d8, 0.12],
      [-120, 260, -820, 760, 0x7a5cf0, 0.15],
      [420, 240, 480, 560, 0xf25ed3, 0.10],
    ]) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: wispTex, color: wc, transparent: true, opacity: wo,
        fog: false, depthWrite: false,
      }));
      sp.position.set(wx, wy, wz);
      sp.scale.setScalar(ws);
      scene.add(sp);
    }
  }

  // ── casks: the loose, hittable, breakable barrels of this world ──────────
  const loose = [];
  const caskSpots = [[6, 4], [7.5, 6], [-10, 10], [24, 14], [-2, -14], [13, -2]];
  for (const [bx, bz] of caskSpots) {
    const base = g(bx, bz);
    const cask = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 1.2, 12), woodMat);
    body.castShadow = true;
    cask.add(body);
    for (const by of [-0.36, 0, 0.36]) {
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.535, 0.045, 6, 14), glowCyanMat);
      hoop.position.y = by;
      hoop.rotation.x = Math.PI / 2;
      cask.add(hoop);
    }
    cask.position.set(bx, base + 0.6, bz);
    props.add(cask);

    const haulable = {
      position: cask.position,
      object3D: cask,
      held: false,
      vel: new THREE.Vector3(),
      spin: new THREE.Vector3(),
      radius: 0.55,
      home: cask.position.clone(),
      hp: 2,
      dead: false,
      _popT: 0,
      _growT: 0,
      _respawnT: 0,
      onCaught: () => { haulable.caught = true; },
    };
    haulable.hit = (dirX, dirZ, power) => {
      if (haulable.dead || haulable.held) return false;
      knock(haulable, dirX, dirZ, power);
      haulable.hp -= 1;
      if (haulable.hp > 0) return true;
      haulable.dead = true;
      haulable._popT = 0.22;
      haulable._respawnT = 16;
      haulable.vel.set(0, 0, 0);
      addCoin(haulable.position.x - 0.6, haulable.position.y + 0.5, haulable.position.z + 0.2);
      addCoin(haulable.position.x + 0.6, haulable.position.y + 0.5, haulable.position.z - 0.2);
      return true;
    };
    level.haulables.push(haulable);
    loose.push(haulable);
  }

  /** The treasure chest, same working lid as the island's. */
  function buildChest(cx, baseY, cz, onOpen) {
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
    // a glow seam, because in this world treasure LEAKS light
    const seam = new THREE.Mesh(new THREE.BoxGeometry(1.46, 0.05, 0.96), glowCoralMat);
    seam.position.y = 0.42;
    chest.add(seam);
    chest.position.set(cx, baseY + 0.45, cz);
    props.add(chest);

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
      pos: new THREE.Vector3(cx, baseY + 0.9, cz),
      radius: 2.8, icon: 'chest', label: 'OPEN',
      onInteract: () => {
        chest.userData.opening = 1;
        loot.visible = true;
        if (onOpen) onOpen();
      },
    });
    chest.userData.openAnim = (dt) => {
      if (!chest.userData.opening) return;
      lid.rotation.x = Math.max(lid.rotation.x - 3.2 * dt, -2.1);
    };
    animated.push(chest);
    return chest;
  }

  // ── the crabs, hue-shifted into void-crabs ───────────────────────────────
  const crabs = [];
  const shifted = new Set();
  for (const [cx, cz] of [[14, -2], [-16, 8], [24, 26], [6, -22]]) {
    const crab = new Crab(level, cx, cz);
    // warm shell reds go violet; eyes, bone and hat stay themselves
    crab.root.traverse((o) => {
      if (!o.material || !o.material.color || shifted.has(o.material)) return;
      const c = o.material.color;
      if (c.r > c.g && c.r > c.b) { c.offsetHSL(0.68, 0.02, 0.02); shifted.add(o.material); }
    });
    props.add(crab.root);
    crabs.push(crab);
  }

  // scattered doubloons along the beach and up the plateau
  for (const [px, pz] of [[2, -26], [-6, -22], [10, -16], [-14, -10], [0, 8], [18, 4], [-20, 16], [8, 18]]) {
    addCoin(px, g(px, pz) + 0.7, pz);
  }

  // ── spawn: on the south beach, facing the skyway ─────────────────────────
  const spawn = new THREE.Vector3(2, 0, -30);
  spawn.y = level.terrainHeight(spawn.x, spawn.z) + 0.2;

  // ── loose physics + prop animation, same contract as the island ──────────
  function updateLoose(dt, water) {
    for (const a of animated) if (a.userData.openAnim) a.userData.openAnim(dt);
    for (const h of loose) {
      if (h.dead) {
        if (h._popT > 0) {
          h._popT -= dt;
          h.object3D.scale.setScalar(Math.max(0.01, h._popT / 0.22));
          if (h._popT <= 0) h.object3D.visible = false;
        } else if ((h._respawnT -= dt) <= 0) {
          h.dead = false;
          h.hp = 2;
          h.position.copy(h.home);
          h.vel.set(0, 0, 0);
          h.spin.set(0, 0, 0);
          h.object3D.rotation.set(0, 0, 0);
          h.object3D.visible = true;
          h._growT = 0.25;
        }
        continue;
      }
      if (h._growT > 0) {
        h._growT -= dt;
        h.object3D.scale.setScalar(1 - 0.7 * Math.max(0, h._growT) / 0.25);
      }
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
        if (h.vel.y < -1.2) h.vel.y *= -0.32;
        else h.vel.y = 0;
        const fric = Math.pow(surf > ground ? 0.02 : 0.16, dt);
        h.vel.x *= fric; h.vel.z *= fric;
        if (h.vel.lengthSq() < 0.05) h.vel.set(0, 0, 0);
      }

      level.resolveHorizontal(h.position, h.radius, 1.0, 0);
      h.object3D.rotation.x += h.spin.x * dt;
      h.object3D.rotation.z += h.spin.z * dt;
      h.spin.multiplyScalar(Math.pow(0.25, dt));
    }
  }

  function knock(h, dirX, dirZ, power) {
    h.vel.set(dirX * power, power * 0.45, dirZ * power);
    h.spin.set((Math.random() - 0.5) * 12, 0, (Math.random() - 0.5) * 12);
  }

  return { level, props, spawn, loose, stairTops, updateLoose, coins, addCoin, crabs };
}

// ── ambience: the moving parts of the sky ───────────────────────────────────
// Comets streak the upper dome, void-jellies drift glowing along the shores,
// and a sister galleon crosses the southern horizon on a very long watch.
export function buildNebulaAmbience(scene, water) {
  const group = new THREE.Group();
  scene.add(group);

  // comets: a bright head with a stretched tail, on staggered loops
  const comets = [];
  for (let i = 0; i < 3; i++) {
    const c = new THREE.Group();
    const head = new THREE.Mesh(new THREE.SphereGeometry(1.4, 8, 6), new THREE.MeshBasicMaterial({ color: 0xeafcff, fog: false, transparent: true }));
    const tail = new THREE.Mesh(new THREE.ConeGeometry(1.1, 26, 7), new THREE.MeshBasicMaterial({ color: 0x9fe8ff, fog: false, transparent: true, opacity: 0.5 }));
    tail.position.z = 14;
    tail.rotation.x = -Math.PI / 2;
    c.add(head); c.add(tail);
    c.visible = false;
    group.add(c);
    comets.push({
      obj: c, head, tail,
      cycle: 8 + i * 4.7, t: i * 3.1,
      from: new THREE.Vector3(), vel: new THREE.Vector3(),
    });
  }

  // void-jellies: lantern medusae bobbing over the shallows
  const jellies = [];
  for (let i = 0; i < 5; i++) {
    const j = new THREE.Group();
    const bell = new THREE.Mesh(
      new THREE.SphereGeometry(0.55, 10, 8, 0, TAU, 0, Math.PI * 0.55),
      new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.75 })
    );
    bell.scale.y = 0.8;
    j.add(bell);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * TAU;
      const arm = new THREE.Mesh(
        new THREE.CylinderGeometry(0.02, 0.05, 0.9, 5),
        new THREE.MeshBasicMaterial({ color: 0x7ab8f0, transparent: true, opacity: 0.55 })
      );
      arm.position.set(Math.cos(a) * 0.3, -0.55, Math.sin(a) * 0.3);
      j.add(arm);
    }
    const a = (i / 5) * TAU;
    j.userData.cx = Math.cos(a) * 48 + rand(-6, 6);
    j.userData.cz = Math.sin(a) * 48 + rand(-6, 6);
    j.userData.r = rand(3, 7);
    j.userData.spd = rand(0.12, 0.3) * (i % 2 ? 1 : -1);
    j.userData.phase = rand(0, TAU);
    group.add(j);
    jellies.push(j);
  }

  // the sister ship: a dark silhouette on a slow crossing, far south
  const sister = new THREE.Group();
  {
    const mat = new THREE.MeshBasicMaterial({ color: 0x241a3a, fog: false });
    const hull = new THREE.Mesh(new THREE.BoxGeometry(16, 3, 4), mat);
    sister.add(hull);
    for (const [mx, mh] of [[3, 12], [-3.4, 10]]) {
      const mast = new THREE.Mesh(new THREE.BoxGeometry(0.5, mh, 0.5), mat);
      mast.position.set(mx, mh / 2 + 1, 0);
      sister.add(mast);
      const sail = new THREE.Mesh(new THREE.PlaneGeometry(5, mh * 0.5), new THREE.MeshBasicMaterial({ color: 0x352a52, fog: false, side: THREE.DoubleSide }));
      sail.position.set(mx, mh * 0.55 + 1, 0);
      sister.add(sail);
    }
    const glow = new THREE.Mesh(new THREE.BoxGeometry(10, 0.4, 0.8), new THREE.MeshBasicMaterial({ color: 0x54e0d0, fog: false }));
    glow.position.y = -2;
    sister.add(glow);
    group.add(sister);
  }

  return {
    update(dt, time) {
      for (const c of comets) {
        c.t += dt;
        if (c.t >= c.cycle) {
          c.t = 0;
          c.from.set(rand(-500, 500), rand(180, 320), rand(-600, -200));
          c.vel.set(rand(-1, 1), rand(-0.4, -0.15), rand(-0.3, 0.3)).normalize().multiplyScalar(150);
          c.obj.lookAt(c.from.clone().sub(c.vel));
        }
        const alive = c.t < 2.4;
        c.obj.visible = alive;
        if (alive) {
          c.obj.position.copy(c.from).addScaledVector(c.vel, c.t);
          const fade = Math.min(1, c.t * 3) * Math.min(1, (2.4 - c.t) * 1.5);
          c.head.material.opacity = fade;
          c.tail.material.opacity = fade * 0.5;
        }
      }
      for (const j of jellies) {
        const u = j.userData;
        const a = time * u.spd + u.phase;
        j.position.set(
          u.cx + Math.cos(a) * u.r,
          water.heightAt(u.cx, u.cz) + 2.2 + Math.sin(time * 0.7 + u.phase) * 0.7,
          u.cz + Math.sin(a) * u.r
        );
        j.scale.y = 1 + Math.sin(time * 2.1 + u.phase) * 0.08;
      }
      const st = (time * 3.5) % 700 - 350;
      sister.position.set(st, 26, -240);
    },
  };
}
