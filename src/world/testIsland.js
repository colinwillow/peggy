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
import { Crab } from './Crab.js';
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

  /** A sea-stack pillar: rock column with a sandy walkable cap. */
  function cylPillar(px, pz, R, bottom, top, rockMat, capMat) {
    const h = top - bottom;
    const centre = new THREE.Vector3(px, bottom + h / 2, pz);
    level.addSolid(new CylinderSolid(centre, R, h / 2, 'pillar'));
    const m = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 1.35, h, 10), rockMat);
    m.position.copy(centre);
    m.castShadow = true;
    m.receiveShadow = true;
    props.add(m);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.02, R * 0.9, 0.22, 10), capMat);
    cap.position.set(px, top - 0.05, pz);
    cap.receiveShadow = true;
    props.add(cap);
  }

  /** Surface heights of the stair run, exported so tests can assert on them. */
  const stairTops = [];
  /** Props with an `openAnim(dt)` in userData — ticked every frame. */
  const animated = [];
  /** Doubloons. main.js walks this for pickup; crabs burst into more of them. */
  const coins = [];
  const coinGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.06, 14);
  const coinMat = toonMaterial({ color: 0xf3c14b, rimStrength: 1.0, rimColor: 0xfff2c0 });

  function addCoin(x, y, z) {
    const c = new THREE.Mesh(coinGeo, coinMat);
    c.position.set(x, y, z);
    c.rotation.z = Math.PI / 2;           // stand it on edge, like a coin should
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

  // ── the ship: a beached galleon, and the reel-anchor course ──────────────
  // Collision stays the two simple boxes (hull volume + walkable deck) so the
  // controller's world is unchanged; everything else is dressing built in a
  // yawed group so the whole vessel can sit at an angle on the sand.
  {
    const wx = 30, wz = 20, yaw = 0.42;
    const base = g(wx, wz);

    box(wx, base - 0.6, wz, 14, 4.4, 6.2, woodMat, yaw, 'hull');
    box(wx, base + 3.6, wz, 12, 0.5, 5, woodDarkMat, yaw);          // the deck
    box(wx - Math.sin(yaw) * 4.6, base + 4.1, wz - Math.cos(yaw) * 4.6,
        4.6, 1.9, 4.4, woodMat, yaw);                               // quarterdeck

    const ship = new THREE.Group();
    ship.position.set(wx, base, wz);
    ship.rotation.y = yaw;
    props.add(ship);
    const sm = (geo, m, x, y, z) => {
      const o = new THREE.Mesh(geo, m);
      o.position.set(x, y, z);
      o.castShadow = true;
      ship.add(o);
      return o;
    };

    // hull strakes: planking rows that flare outward as they rise, which is
    // what turns two boxes into something that reads as a hull
    for (let row = 0; row < 4; row++) {
      const y = 0.2 + row * 1.0;
      const flare = 3.15 + row * 0.28;
      const len = 13.2 + row * 0.9;
      for (const side of [-1, 1]) {
        const strake = sm(new THREE.BoxGeometry(len, 1.05, 0.24),
          row % 2 ? woodMat : woodDarkMat, 0, y, side * flare);
        strake.rotation.x = side * -0.16;
      }
    }
    // gold trim line along the top strake
    for (const side of [-1, 1]) {
      sm(new THREE.BoxGeometry(15.4, 0.16, 0.1), goldMat, 0, 3.42, side * 4.05);
    }
    // bow: a tapered prow + bowsprit
    const bow = sm(new THREE.ConeGeometry(2.4, 5.2, 8), woodMat, 8.6, 1.7, 0);
    bow.rotation.z = -Math.PI / 2;
    bow.scale.set(1, 1, 0.72);
    const sprit = sm(new THREE.CylinderGeometry(0.10, 0.16, 5.4, 7), woodDarkMat, 11.6, 3.6, 0);
    sprit.rotation.z = -1.12;
    // stern transom + lanterns
    sm(new THREE.BoxGeometry(0.6, 3.6, 5.6), woodDarkMat, -7.2, 2.6, 0);
    for (const lz of [-1.8, 1.8]) {
      sm(new THREE.SphereGeometry(0.22, 8, 6), goldMat, -7.6, 4.6, lz);
    }
    // railing posts along both bulwarks
    for (let i = 0; i < 9; i++) {
      const x = -5.4 + i * 1.35;
      for (const side of [-1, 1]) {
        sm(new THREE.BoxGeometry(0.12, 0.8, 0.12), woodDarkMat, x, 4.2, side * 2.45);
      }
    }
    for (const side of [-1, 1]) {
      sm(new THREE.BoxGeometry(12.4, 0.12, 0.16), woodMat, 0.5, 4.62, side * 2.45);
    }
    // two masts, yards, sails, and the colours
    for (const [mxOff, mh] of [[2.2, 10.5], [-3.4, 8.5]]) {
      sm(new THREE.CylinderGeometry(0.22, 0.30, mh, 8), woodMat, mxOff, 3.8 + mh / 2, 0);
      const yard = sm(new THREE.CylinderGeometry(0.11, 0.11, 6.4, 6), woodDarkMat, mxOff, 3.8 + mh * 0.78, 0);
      yard.rotation.x = Math.PI / 2;
      const sail = sm(new THREE.PlaneGeometry(5.6, mh * 0.42), sailMat, mxOff - 0.4, 3.8 + mh * 0.55, 0);
      sail.rotation.y = Math.PI / 2;
      sail.castShadow = false;
    }
    // the black flag
    const flag = sm(new THREE.PlaneGeometry(1.9, 1.1), toonMaterial({ color: 0x2a2438, side: THREE.DoubleSide }), 2.2 + 1.1, 3.8 + 10.5 + 0.4, 0);
    flag.rotation.y = Math.PI / 2;
    flag.castShadow = false;
    const skullDot = sm(new THREE.SphereGeometry(0.16, 8, 6), toonMaterial({ color: 0xf0e6cf }), 2.2 + 1.1, 3.8 + 10.5 + 0.4, 0.02);
    skullDot.scale.set(1, 0.9, 0.4);

    // reel anchors: at body height, so they yank you across rather than up
    anchor(wx - 8.5, base + 4.2, wz - 2.0, 'anchor');
    anchor(wx + 7.5, base + 4.6, wz + 2.5, 'anchor');
    anchor(wx, base + 9.5, wz, 'swing');
  }

  // ── palms and rocks, for shade and silhouette ────────────────────────────
  // A function rather than a loop body, because the treasure islet wants one
  // too — and the islet doesn't exist yet at this point in the build, so its
  // palm is planted further down, after addIsland has raised the ground.
  const palmSpots = [
    [-22, -18], [-30, 4], [8, 26], [20, -22], [-8, -28], [34, -4], [-34, -30], [16, 12],
  ];
  for (const [px, pz] of palmSpots) palm(px, pz);
  function palm(px, pz) {
    const base = g(px, pz);
    if (base < 1.2) return;
    const lean = rand(-0.22, 0.22);
    const h = rand(4.5, 7.5);
    // Curved trunk: five stacked segments, each tipped a little further, so it
    // sweeps like a palm instead of standing like a telegraph pole.
    const segs = 5;
    let tx = px, ty = base, tzz = pz, tilt = lean;
    for (let si = 0; si < segs; si++) {
      const sh = h / segs;
      const seg = new THREE.Mesh(
        new THREE.CylinderGeometry(0.30 - si * 0.038, 0.34 - si * 0.038, sh * 1.15, 8),
        trunkMat
      );
      seg.position.set(tx + Math.sin(tilt) * sh * 0.5, ty + sh * 0.5, tzz);
      seg.rotation.z = -tilt;
      seg.castShadow = true;
      props.add(seg);
      tx += Math.sin(tilt) * sh;
      ty += Math.cos(tilt) * sh * 0.98;
      tilt += lean * 0.55;
    }
    level.addSolid(new CylinderSolid(new THREE.Vector3(px, base + h / 2, pz), 0.36, h / 2, 'palm'));

    const crown = new THREE.Group();
    crown.position.set(tx, ty, tzz);
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

  /**
   * A treasure chest with a working lid: tap to open, the gold inside rises.
   * Returns the group. When it opens, `onOpen` fires — the archipelago chest
   * uses it to pay out real, collectable doubloons.
   */
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
      loot.position.y = Math.min(loot.position.y + 0.5 * dt, 0.42);
    };
    animated.push(chest);
    return chest;
  }

  // ── the spire chest: only reachable by climbing or hooking up ────────────
  {
    const cx = -46, cz = 52;
    const base = g(cx, cz);
    buildChest(cx, base, cz);
    anchor(cx + 3, base + 6, cz + 2, 'swing');
  }

  // ── the shack: a door, because a door is the clearest context action ─────
  {
    const sx = 18, sz = 14;
    const base = g(sx, sz);
    box(sx, base, sz, 4.4, 3.0, 3.6, woodMat, 0.3);
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

  // ── the ship's wheel on the galleon ──────────────────────────────────────
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
      onInteract: () => { wheel.userData.spin2 = (wheel.userData.spin2 || 0) + 9; },
    });
    wheel.userData.openAnim = (dt) => {
      if (!wheel.userData.spin2) return;
      wheel.rotation.z += wheel.userData.spin2 * dt;
      wheel.userData.spin2 = Math.abs(wheel.userData.spin2) < 0.05 ? 0 : wheel.userData.spin2 * Math.pow(0.22, dt);
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

  // ── rocks: silhouette breakers along the coast ───────────────────────────
  {
    const rockMat = toonMaterial({ color: 0x9a8d7d, rimStrength: 0.35 });
    const rockDark = toonMaterial({ color: 0x7d7060, rimStrength: 0.3 });
    const spots = [
      [-18, -34, 1.9], [24, -30, 1.3], [40, 8, 1.6], [-32, 22, 2.2],
      [-6, 36, 1.1], [14, 34, 0.8], [-40, -12, 1.4], [52, -14, 1.0],
      [70, -34, 1.5], [86, -20, 1.1],
    ];
    for (const [rx, rz, rs] of spots) {
      const ry = g(rx, rz);
      if (ry < -3) continue;
      const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(rs, 0), Math.random() < 0.5 ? rockMat : rockDark);
      rock.position.set(rx, ry + rs * 0.35, rz);
      rock.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
      rock.scale.set(1, rand(0.6, 0.9), rand(0.8, 1.2));
      rock.castShadow = true;
      rock.receiveShadow = true;
      props.add(rock);
      if (rs > 1.4) {
        level.addSolid(new CylinderSolid(new THREE.Vector3(rx, ry + rs * 0.35, rz), rs * 0.8, rs * 0.5, 'rock'));
      }
    }
  }

  // ── grass and flowers: two instanced meshes, two draw calls ──────────────
  // This is most of what turns "green heightfield" into "meadow". Instancing
  // keeps it essentially free; each blade is a cone with a per-instance tint.
  {
    const tuftGeo = new THREE.ConeGeometry(0.09, 0.55, 5);
    tuftGeo.translate(0, 0.24, 0);
    const tuftMat = toonMaterial({ color: 0xffffff, rimStrength: 0.2 });
    const tufts = new THREE.InstancedMesh(tuftGeo, tuftMat, 460);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const YUP = new THREE.Vector3(0, 1, 0);
    const cA = new THREE.Color(0x3da84c), cB = new THREE.Color(0x86e06a);
    const tint = new THREE.Color();
    let n = 0;
    for (let tries = 0; tries < 6000 && n < 460; tries++) {
      const x = rand(-72, 72), z = rand(-72, 72);
      const y = g(x, z);
      if (y < 2.0 || y > 9.6) continue;
      if (level.terrainNormal(x, z).y < 0.86) continue;
      q.setFromAxisAngle(YUP, rand(0, TAU));
      const sc = rand(0.7, 1.7);
      m4.compose(new THREE.Vector3(x, y - 0.03, z), q, new THREE.Vector3(sc, rand(0.7, 1.5), sc));
      tufts.setMatrixAt(n, m4);
      tufts.setColorAt(n, tint.copy(cA).lerp(cB, Math.random()));
      n++;
    }
    tufts.count = n;
    tufts.receiveShadow = true;
    if (tufts.instanceColor) tufts.instanceColor.needsUpdate = true;
    props.add(tufts);

    const petalGeo = new THREE.SphereGeometry(0.09, 6, 5);
    petalGeo.translate(0, 0.22, 0);
    const petalMat = toonMaterial({ color: 0xffffff, rimStrength: 0.3 });
    const flowers = new THREE.InstancedMesh(petalGeo, petalMat, 90);
    const fCols = [new THREE.Color(0xfff4f8), new THREE.Color(0xff7ab0), new THREE.Color(0xffd76a)];
    let fn = 0;
    for (let tries = 0; tries < 3000 && fn < 90; tries++) {
      const x = rand(-68, 68), z = rand(-68, 68);
      const y = g(x, z);
      if (y < 2.4 || y > 8.8) continue;
      if (level.terrainNormal(x, z).y < 0.9) continue;
      q.setFromAxisAngle(YUP, rand(0, TAU));
      const sc = rand(0.7, 1.2);
      m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sc, sc, sc));
      flowers.setMatrixAt(fn, m4);
      flowers.setColorAt(fn, fCols[(Math.random() * fCols.length) | 0]);
      fn++;
    }
    flowers.count = fn;
    if (flowers.instanceColor) flowers.instanceColor.needsUpdate = true;
    props.add(flowers);
  }

  // ── clouds: soft stacks drifting over the sea ────────────────────────────
  {
    const cloudMat = toonMaterial({ color: 0xffffff, rimStrength: 0.12, rimColor: 0xfff6e0 });
    for (let ci = 0; ci < 6; ci++) {
      const cl = new THREE.Group();
      const k = rand(0.8, 1.7);
      for (let b = 0; b < 5; b++) {
        const puff = new THREE.Mesh(new THREE.SphereGeometry(rand(2.4, 4.4) * k, 10, 8), cloudMat);
        puff.position.set(rand(-5, 5) * k, rand(-0.8, 0.8), rand(-2.2, 2.2) * k);
        puff.scale.y = 0.52;
        cl.add(puff);
      }
      cl.position.set(rand(-170, 170), rand(46, 82), rand(-170, 170));
      const drift = rand(1.0, 2.2);
      cl.userData.openAnim = (dt) => {
        cl.position.x += drift * dt;
        if (cl.position.x > 230) cl.position.x = -230;
      };
      animated.push(cl);
      props.add(cl);
    }
  }

  // ── THE ARCHIPELAGO: a stepping-stone hop course off the south beach ─────
  // Gaps are tuned against the measured movement numbers, not guessed:
  // a running jump covers ~7m and run + double jump ~10m, so the course
  // escalates walk-on -> easy -> running -> full-momentum -> double-jump, and
  // the last gap is honestly impossible without the double. Pillar tops rise a
  // little each step so falling short drops you in the sea, which in this game
  // is a swim back rather than a punishment.
  {
    const R = 1.7;                       // pillar top radius
    const rockMat = toonMaterial({ color: 0x93856f, rimStrength: 0.3 });
    const capMat = toonMaterial({ color: 0xf6e7b2, rimStrength: 0.25 });
    // [x, z, topHeight] — consecutive edge gaps: 2.7, 3.6, 4.5, 8.4.
    // The last pillar stands at the islet's rim, so the double-jump beat is
    // the fourth gap and landing it delivers you to the treasure.
    const steps = [
      [-6.0, -52.0, 1.2],
      [-5.2, -58.0, 1.6],
      [-3.6, -64.8, 2.0],
      [-1.4, -72.4, 2.4],
      [2.3, -83.6, 2.6],
    ];
    let prev = null;
    for (const [px, pz, top] of steps) {
      // solid from below the sea to the top, so a short jump bonks the side
      // and drops you in the water instead of clipping through
      const bottom = -7;
      cylPillar(px, pz, R, bottom, top, rockMat, capMat);
      addCoin(px, top + 0.9, pz);
      prev = [px, pz];
    }

    // The treasure islet at the end of both routes.
    level.addIsland({ cx: 2, cz: -92, radius: 8.5, height: 3.6, plateau: 0.5, rough: 0.2 });
    const ty = level.terrainHeight(2, -92);
    // One palm for shade — and for the title screen, which frames this islet:
    // chest, palm, water, her. Planted north-west of the chest so it reads as
    // backdrop from the title camera instead of a trunk through the frame.
    palm(-2.4, -90.6);
    // a ring of doubloons and the chest that earns the trip
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      addCoin(2 + Math.cos(a) * 2.6, level.terrainHeight(2 + Math.cos(a) * 2.6, -92 + Math.sin(a) * 2.6) + 0.7, -92 + Math.sin(a) * 2.6);
    }
    buildChest(2, ty, -92, () => {
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU;
        addCoin(2 + Math.cos(a) * rand(1.2, 3.4), ty + 0.8, -92 + Math.sin(a) * rand(1.2, 3.4));
      }
    });
  }

  // ── THE MONKEY BARS: the hook route over the lagoon ──────────────────────
  // A line of horizontal bars on pilings, running parallel to the hop course.
  // Each is a BAR anchor — the hook latches wherever along it you threw, so
  // you swing from your grab point like monkey bars, not from a fixed ring.
  // Rhythm: swing, release at the top of the arc, hold mid-air, throw at the
  // next. Coins hang under each gap to draw the arc you should be carving.
  {
    const barY = 6.4;
    const bars = [
      [6.5, -52], [8.0, -60], [9.0, -68], [9.5, -76], [8.5, -84],
    ];
    for (let i = 0; i < bars.length; i++) {
      const [bx, bz] = bars[i];
      // the bar: gold-capped, horizontal, athwart the direction of travel
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 3.4, 8), woodDarkMat);
      bar.position.set(bx, barY, bz);
      bar.rotation.z = Math.PI / 2;
      bar.castShadow = true;
      props.add(bar);
      for (const e of [-1.7, 1.7]) {
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), goldMat);
        cap.position.set(bx + e, barY, bz);
        props.add(cap);
      }
      // pilings down into the sea, so the structure reads as built, not floating
      for (const e of [-1.7, 1.7]) {
        const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, barY + 6, 7), woodMat);
        pile.position.set(bx + e, (barY - 6) / 2, bz);
        pile.castShadow = true;
        props.add(pile);
      }
      const brace = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.4, 6), woodMat);
      brace.position.set(bx, barY - 1.1, bz);
      brace.rotation.z = Math.PI / 2;
      props.add(brace);

      level.addGrapplePoint(new THREE.Vector3(bx, barY, bz), {
        kind: 'swing', axisX: 1, axisZ: 0, halfLen: 1.7,
      });
      // a coin at the bottom of the swing arc between this bar and the next
      if (i < bars.length - 1) {
        const [nx, nz] = bars[i + 1];
        addCoin((bx + nx) / 2, barY - 3.6, (bz + nz) / 2);
      }
    }
  }

  // ── the crabs ────────────────────────────────────────────────────────────
  const crabs = [];
  for (const [cx, cz] of [[14, -2], [-16, 8], [24, 26], [6, -22]]) {
    const crab = new Crab(level, cx, cz);
    props.add(crab.root);
    crabs.push(crab);
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

  return { level, props, spawn, loose, stairTops, updateLoose, knock, coins, addCoin, crabs };
}
