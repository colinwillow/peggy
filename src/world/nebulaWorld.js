// THE MAROON NEBULA — the space-pirate world.
//
// Same bones as the test island (heightfield islands in a sea, solids, hook
// anchors, loose casks, crabs, coins), wearing a different sky: the "sea" is
// a stardust lagoon, the islands are alien planetoids, the palms are
// tentacle-trees, the galleon FLIES, and the horizon is a ringed gas giant
// over a field of stars. Everything the controller can do on the island it
// can do here — this file only changes what the doing looks like.
//
// On detail: nothing here is downloaded. Wood grain, barrel staves and the
// jolly roger are runtime canvas textures; hulls and arms are curves, not
// boxes; the small stuff (pebbles, tufts, flowers) is instanced so a few
// hundred pieces of clutter cost four draw calls. The blocky pass this file
// replaced kept the layout — every solid, anchor and spawn is where it was.
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

// ── canvas textures: detail with zero downloads ─────────────────────────────

function canvasTex(w, h, draw) {
  const cnv = document.createElement('canvas');
  cnv.width = w; cnv.height = h;
  draw(cnv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cnv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Horizontal planking: tone-jittered boards, dark seams, nail dots. */
function plankTexture(base = '#a879c4', seam = '#5a3f78', nails = '#d8c2ea') {
  return canvasTex(128, 128, (ctx, w, h) => {
    const rows = 4;
    for (let r = 0; r < rows; r++) {
      const jitter = (r * 37) % 3;
      ctx.fillStyle = [base, shade(base, -12), shade(base, 10)][jitter];
      ctx.fillRect(0, (r * h) / rows, w, h / rows);
      // grain: a few faint long strokes
      ctx.strokeStyle = shade(base, -22);
      ctx.lineWidth = 1;
      for (let gI = 0; gI < 3; gI++) {
        const gy = (r * h) / rows + 6 + gI * 9 + jitter * 2;
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.bezierCurveTo(w * 0.3, gy + 2, w * 0.7, gy - 2, w, gy + 1);
        ctx.stroke();
      }
      // seam
      ctx.fillStyle = seam;
      ctx.fillRect(0, (r * h) / rows, w, 3);
      // butt joints + nails, offset per row
      const bx = ((r * 53) % w);
      ctx.fillRect(bx, (r * h) / rows, 3, h / rows);
      ctx.fillStyle = nails;
      ctx.fillRect((bx + 8) % w, (r * h) / rows + 6, 2, 2);
      ctx.fillRect((bx + 8) % w, ((r + 1) * h) / rows - 8, 2, 2);
    }
  });
}

/** Vertical barrel staves. */
function staveTexture(base = '#9a68b8', seam = '#53386b') {
  return canvasTex(128, 64, (ctx, w, h) => {
    const cols = 8;
    for (let c = 0; c < cols; c++) {
      ctx.fillStyle = [base, shade(base, -14), shade(base, 8)][c % 3];
      ctx.fillRect((c * w) / cols, 0, w / cols, h);
      ctx.fillStyle = seam;
      ctx.fillRect((c * w) / cols, 0, 2, h);
    }
  });
}

/** The colours' own arithmetic — lighten/darken a #rrggbb by `amt`. */
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amt));
  const gg = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `#${((r << 16) | (gg << 8) | b).toString(16).padStart(6, '0')}`;
}

/** The jolly roger: a one-eyed skull, because everyone here is a cyclops. */
function jollyRogerTexture() {
  return canvasTex(128, 96, (ctx, w, h) => {
    ctx.fillStyle = '#241a3a';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#3a2c58';
    ctx.lineWidth = 3;
    ctx.strokeRect(1, 1, w - 2, h - 2);
    // skull
    ctx.fillStyle = '#efe6f7';
    ctx.beginPath();
    ctx.arc(w / 2, 36, 20, Math.PI, 0);               // dome
    ctx.lineTo(w / 2 + 20, 44);
    ctx.quadraticCurveTo(w / 2, 60, w / 2 - 20, 44);  // jaw
    ctx.closePath();
    ctx.fill();
    // the one eye
    ctx.fillStyle = '#241a3a';
    ctx.beginPath();
    ctx.arc(w / 2, 36, 8.5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#7df5e3';
    ctx.beginPath();
    ctx.arc(w / 2 + 2, 34, 3, 0, TAU);                // a glint, cyan like the jets
    ctx.fill();
    // teeth
    ctx.fillStyle = '#241a3a';
    for (let i = -1; i <= 1; i++) ctx.fillRect(w / 2 + i * 6 - 1, 48, 2, 7);
    // crossbones
    ctx.strokeStyle = '#efe6f7';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(w / 2 - s * 26, 66);
      ctx.lineTo(w / 2 + s * 26, 86);
      ctx.stroke();
    }
    ctx.fillStyle = '#efe6f7';
    for (const [bx, by] of [[w / 2 - 26, 66], [w / 2 + 26, 66], [w / 2 - 26, 86], [w / 2 + 26, 86]]) {
      ctx.beginPath(); ctx.arc(bx, by - 2, 4, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(bx, by + 3, 4, 0, TAU); ctx.fill();
    }
  });
}

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
  const metalMat = toonMaterial({ color: 0x8a92b8, rimStrength: 0.9, rimColor: 0xdfe8ff });
  const ropeMat = toonMaterial({ color: 0xd8b8e8 });
  // Glow things are UNLIT on purpose: in a dim world, a MeshBasicMaterial IS
  // a light source to the eye, at zero lighting cost.
  const glowCyanMat = new THREE.MeshBasicMaterial({ color: GLOW_CYAN });
  const glowMagentaMat = new THREE.MeshBasicMaterial({ color: GLOW_MAGENTA });
  const glowCoralMat = new THREE.MeshBasicMaterial({ color: GLOW_CORAL });

  // plank materials: one canvas, separate textures so repeats differ per use
  const deckMat = toonMaterial({ color: 0xc9a0e0, map: plankTexture('#b98fd4', '#5a3f78') });
  deckMat.map.repeat.set(3, 2);
  const hullMat = toonMaterial({ color: 0xffffff, map: plankTexture('#8a5cae', '#4a3060') });
  hullMat.map.repeat.set(0.35, 0.9);
  const caskBodyMat = toonMaterial({ color: 0xffffff, map: staveTexture() });

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

  /** A thin curved tube along a few points — rigging, roots, tendrils. */
  function tube(points, radius, mat, segs = 24) {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
    const m = new THREE.Mesh(new THREE.TubeGeometry(curve, segs, radius, 6, false), mat);
    props.add(m);
    return m;
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
    // a scatter of ground shards around the cluster's feet
    for (let i = 0; i < 3; i++) {
      crystal(x + rand(-1.6, 1.6), y - 0.15, z + rand(-1.6, 1.6), rand(0.12, 0.22),
        i % 2 ? glowCyanMat : glowMagentaMat);
    }
  }

  /**
   * A tentacle-tree: this world's palm. A smooth tube that curls like an
   * octopus arm reaching out of the ground — thick trunk fading to a curled
   * tip, sucker-discs down the inner curve, a glow-bulb at the end, and a
   * flared root boss at the base.
   */
  function tentacleTree(px, pz, height = 5.2, lean = 0.55) {
    const base = g(px, pz);
    const dir = rand(0, TAU);
    const sx = Math.sin(dir), sz = Math.cos(dir);
    // the arm's spine: rises, leans, then curls over at the tip
    const pts = [];
    const N = 7;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const bend = t * t * lean * height * 0.55;
      const curl = Math.max(0, t - 0.72) * height * 0.9;   // the tip hooks over
      pts.push(new THREE.Vector3(
        px + sx * (bend + curl * 0.4),
        base + t * height - curl * 0.55,
        pz + sz * (bend + curl * 0.4)
      ));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    // two tubes make the taper: a thick lower arm, a slim upper one
    const lower = new THREE.Mesh(new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3(curve.getPoints(12).slice(0, 8).map((p) => p.clone())), 12, 0.42, 9, false), woodMat);
    lower.castShadow = true;
    props.add(lower);
    const upper = new THREE.Mesh(new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3(curve.getPoints(12).slice(6).map((p) => p.clone())), 12, 0.22, 8, false), woodMat);
    upper.castShadow = true;
    props.add(upper);
    // root boss: a squat flared cone gripping the ground
    const root = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.05, 1.0, 9), woodDarkMat);
    root.position.set(px, base + 0.4, pz);
    root.castShadow = true;
    props.add(root);
    // suckers down the inner curve
    for (let i = 3; i < 10; i++) {
      const t = i / 11;
      const p = curve.getPointAt(Math.min(t, 1));
      const r = 0.34 * (1 - t * 0.6);
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.6, r * 0.75, 0.07, 8), tealMat);
      disc.position.set(p.x - sx * r * 1.15, p.y, p.z - sz * r * 1.15);
      disc.rotation.z = sx * 1.35;
      disc.rotation.x = -sz * 1.35;
      props.add(disc);
    }
    // the glow bulb hanging off the curled tip
    const tip = curve.getPointAt(1);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), glowCoralMat);
    bulb.position.set(tip.x, tip.y - 0.25, tip.z);
    props.add(bulb);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 5), woodDarkMat);
    stem.position.set(tip.x, tip.y - 0.05, tip.z);
    props.add(stem);
  }

  /** A giant mushroom. Big ones get a solid cap you can stand on. */
  function mushroom(px, pz, capR = 1.6, height = 2.2, walkable = false) {
    const base = g(px, pz);
    // the stem bows slightly, and flares at ground and gills
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(capR * 0.30, capR * 0.48, height, 10), toonMaterial({ color: 0xe8ddf0 }));
    stem.position.set(px, base + height / 2, pz);
    stem.castShadow = true;
    props.add(stem);
    const gills = new THREE.Mesh(new THREE.CylinderGeometry(capR * 0.82, capR * 0.4, 0.28, 12), toonMaterial({ color: 0xd4b8ea }));
    gills.position.set(px, base + height - 0.1, pz);
    props.add(gills);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(capR, 16, 12, 0, TAU, 0, Math.PI * 0.5), capMat);
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
      spot.rotation.set(Math.sin(a) * f * 0.8, 0, -Math.cos(a) * f * 0.8);
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

  // ── instanced clutter: hundreds of pieces, four draw calls ───────────────
  // Pebbles and rocks on the sand, moss tufts on the plateau, glow-flowers
  // near the shore. Instances are culled by height band so each kind lands
  // where it belongs, and every transform is baked once at build time.
  {
    const dummy = new THREE.Object3D();
    function scatter(geo, mat, count, place) {
      const inst = new THREE.InstancedMesh(geo, mat, count);
      let n = 0;
      let guard = 0;
      while (n < count && guard++ < count * 30) {
        const a = rand(0, TAU), r = Math.sqrt(rand(0, 1)) * 56;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        const y = g(x, z);
        if (!place(x, y, z, dummy)) continue;
        dummy.updateMatrix();
        inst.setMatrixAt(n++, dummy.matrix);
      }
      inst.count = n;
      inst.castShadow = false;
      inst.receiveShadow = true;
      props.add(inst);
    }
    // pebbles: everywhere the sand is
    scatter(new THREE.TetrahedronGeometry(0.16, 0), rockDarkMat, 90, (x, y, z, d) => {
      if (y < 0.25 || y > 2.2) return false;
      d.position.set(x, y + 0.05, z);
      d.rotation.set(rand(0, TAU), rand(0, TAU), 0);
      d.scale.setScalar(rand(0.6, 1.8));
      return true;
    });
    // moss tufts: little teal spikes on the plateau
    scatter(new THREE.ConeGeometry(0.09, 0.42, 5), tealMat, 130, (x, y, z, d) => {
      if (y < 1.6 || y > 9) return false;
      d.position.set(x, y + 0.15, z);
      d.rotation.set(rand(-0.25, 0.25), rand(0, TAU), rand(-0.25, 0.25));
      d.scale.setScalar(rand(0.7, 1.6));
      return true;
    });
    // glow-flowers: tiny magenta stars near the waterline
    scatter(new THREE.OctahedronGeometry(0.09, 0), glowMagentaMat, 46, (x, y, z, d) => {
      if (y < 0.15 || y > 1.2) return false;
      d.position.set(x, y + 0.08, z);
      d.rotation.set(rand(0, TAU), rand(0, TAU), 0);
      d.scale.setScalar(rand(0.7, 1.4));
      return true;
    });
    // boulders: bigger, rarer, up on the moss
    scatter(new THREE.DodecahedronGeometry(0.7, 0), rockMat, 22, (x, y, z, d) => {
      if (y < 1.4 || y > 8.5) return false;
      d.position.set(x, y + 0.2, z);
      d.rotation.set(rand(0, TAU), rand(0, TAU), 0);
      d.scale.set(rand(0.5, 1.7), rand(0.4, 1.2), rand(0.5, 1.7));
      return true;
    });
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

  // ── the shell hut: somebody lives here ───────────────────────────────────
  // A snail-shell dome with a round glowing door-window and an antenna: the
  // first hint of civilisation beyond the crew. Solid, so it is a real wall.
  {
    const hx = 22, hz = 20;
    const hy = g(hx, hz);
    level.addSolid(new CylinderSolid(new THREE.Vector3(hx, hy + 1.2, hz), 2.3, 1.2, 'hut'));
    const shell = new THREE.Mesh(new THREE.SphereGeometry(2.3, 18, 14), capMat);
    shell.position.set(hx, hy + 1.1, hz);
    shell.scale.y = 0.85;
    shell.castShadow = true;
    props.add(shell);
    // the whorl: three shrinking ridges spiralling up the shell
    for (let i = 0; i < 3; i++) {
      const ridge = new THREE.Mesh(new THREE.TorusGeometry(2.3 - i * 0.55, 0.09, 6, 20), toonMaterial({ color: 0x9a78c0 }));
      ridge.position.set(hx, hy + 1.1 + i * 0.55, hz);
      ridge.rotation.x = Math.PI / 2;
      ridge.scale.y = 0.85;
      props.add(ridge);
    }
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), toonMaterial({ color: 0x9a78c0 }));
    knob.position.set(hx, hy + 2.9, hz);
    props.add(knob);
    // door: a dark round arch facing the beach, with a coral glow inside
    const door = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.3, 14, 1, false, 0, Math.PI), toonMaterial({ color: 0x2c1f45 }));
    door.position.set(hx - 0.2, hy + 0.85, hz - 2.15);
    door.rotation.set(Math.PI / 2, 0, 0);
    props.add(door);
    const doorGlow = new THREE.Mesh(new THREE.CircleGeometry(0.55, 12), glowCoralMat);
    doorGlow.position.set(hx - 0.2, hy + 0.8, hz - 2.32);
    props.add(doorGlow);
    // antenna with a blinking tip
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 2.4, 6), metalMat);
    mast.position.set(hx + 1.3, hy + 3.6, hz + 0.6);
    mast.rotation.z = -0.15;
    props.add(mast);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), glowMagentaMat.clone());
    beacon.position.set(hx + 1.63, hy + 4.8, hz + 0.6);
    beacon.userData.openAnim = (dt) => {
      beacon.userData.t = (beacon.userData.t || 0) + dt;
      beacon.material.color.setHex(Math.sin(beacon.userData.t * 4) > 0 ? GLOW_MAGENTA : 0x6b2a58);
    };
    animated.push(beacon);
    props.add(beacon);
    // knocking makes the light inside flare — somebody is home, not answering
    level.addInteractable({
      pos: new THREE.Vector3(hx - 0.2, hy + 1.0, hz - 2.3),
      radius: 2.2, icon: 'door', label: 'KNOCK', once: false,
      onInteract: () => { doorGlow.userData.flareT = 1.2; return false; },
    });
    doorGlow.userData.openAnim = (dt) => {
      if (doorGlow.userData.flareT > 0) {
        doorGlow.userData.flareT -= dt;
        const f = 1 + Math.sin(doorGlow.userData.flareT * 12) * 0.5 * doorGlow.userData.flareT;
        doorGlow.scale.setScalar(f);
      }
    };
    animated.push(doorGlow);
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
      box(x, bottom, bz, W, top - bottom, 2.2, deckMat, 0, 'crate');
      stairTops.push(top);
    }
    const lastX = bx + rises.length * W + 0.2;
    box(lastX, g(lastX, bz) - 1.0, bz, 2.4, top + 0.9 - (g(lastX, bz) - 1.0), 2.4, deckMat, 0.15);
  }

  // ── THE SKYWAY: floating rock slabs over the void-sea ────────────────────
  // The archipelago, translated into this world's language: instead of sea
  // stacks the slabs HOVER, crystals burning underneath. Gaps 4 / 6 / 8m
  // escalate to a 16m finale that honestly needs the double jump; falling
  // short is a splash into stardust and a swim back.
  /** A floating slab: walkable cap, rocky underside, roots, hover-glow. */
  function floatSlab(px, pz, topY, R) {
    const thick = 1.3;
    level.addSolid(new CylinderSolid(new THREE.Vector3(px, topY - thick / 2, pz), R, thick / 2, 'float'));
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 0.82, thick, 10), rockMat);
    cap.position.set(px, topY - thick / 2, pz);
    cap.castShadow = true;
    cap.receiveShadow = true;
    props.add(cap);
    // mossy lip overhanging the rim — its top face sits a hair BELOW the
    // cap's, because two coplanar faces z-fight into hatched garbage on a
    // phone's depth precision
    const lip = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.06, R * 0.98, 0.2, 10), tealMat);
    lip.position.set(px, topY - 0.125, pz);
    lip.receiveShadow = true;
    props.add(lip);
    const keel = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.8, 0.12, R * 1.15, 9), rockDarkMat);
    keel.position.set(px, topY - thick - R * 0.55, pz);
    keel.castShadow = true;
    props.add(keel);
    // roots that used to hold it down, trailing in the void
    for (let i = 0; i < 3; i++) {
      const a = rand(0, TAU);
      const rx = px + Math.cos(a) * R * 0.7, rz = pz + Math.sin(a) * R * 0.7;
      tube([
        [rx, topY - thick + 0.2, rz],
        [rx + rand(-0.5, 0.5), topY - thick - rand(0.8, 1.4), rz + rand(-0.5, 0.5)],
        [rx + rand(-1, 1), topY - thick - rand(2, 3.2), rz + rand(-1, 1)],
      ], 0.06 + R * 0.015, woodDarkMat, 10);
    }
    // grass tufts on the rim
    for (let i = 0; i < 4; i++) {
      const a = rand(0, TAU);
      const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.5, 5), tealMat);
      tuft.position.set(px + Math.cos(a) * R * 0.8, topY + 0.2, pz + Math.sin(a) * R * 0.8);
      tuft.rotation.set(rand(-0.3, 0.3), 0, rand(-0.3, 0.3));
      props.add(tuft);
    }
    const shard = new THREE.Mesh(new THREE.OctahedronGeometry(R * 0.24, 0), glowCyanMat);
    shard.position.set(px, topY - thick - R * 0.62, pz);
    shard.userData.openAnim = (dt) => { shard.rotation.y += 0.9 * dt; };
    animated.push(shard);
    props.add(shard);
    // the hover-glow: a faint ring of light under the keel
    const halo = new THREE.Mesh(new THREE.TorusGeometry(R * 0.5, 0.05, 6, 18),
      new THREE.MeshBasicMaterial({ color: GLOW_CYAN, transparent: true, opacity: 0.35, depthWrite: false }));
    halo.position.set(px, topY - thick - R * 0.3, pz);
    halo.rotation.x = Math.PI / 2;
    props.add(halo);
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
    crystal(ix - 3.2, itop, iz + 1.5, 1.5, glowMagentaMat);
    crystal(ix + 2.8, itop, iz - 2.0, 1.0, glowCyanMat);
    // a ring of standing stones around the chest, because treasure deserves
    // a little architecture
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + 0.3;
      const stone = new THREE.Mesh(new THREE.BoxGeometry(0.5, rand(1.0, 1.6), 0.35), rockDarkMat);
      stone.position.set(ix + Math.cos(a) * 4.6, itop + 0.6, iz + Math.sin(a) * 4.6);
      stone.rotation.y = a + rand(-0.2, 0.2);
      stone.rotation.z = rand(-0.08, 0.08);
      stone.castShadow = true;
      props.add(stone);
    }
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

  // ── THE SKY-GALLEON ──────────────────────────────────────────────────────
  // A real pirate ship that happens to fly. The hull is a curved side profile
  // extruded across the beam and bevelled round; planking is painted on; the
  // sails billow; and it hovers on three DOWNWARD jets whose flames flicker —
  // that is what's holding it up, and the silhouette says so.
  // Gameplay is untouched: same deck solids, helm, chest and anchors.
  const GALLEON = { x: -68, z: -6, deck: 6.5 };
  {
    const { x, z, deck } = GALLEON;
    const YAW = 0.12;
    // solids stay world-space, exactly where the blocky ship had them
    box(x, deck - 0.5, z, 13.0, 0.5, 4.6, deckMat, YAW, 'deck');
    box(x - 4.6, deck, z - 0.2, 3.2, 1.6, 4.0, hullMat, YAW, 'stern');

    // everything visual lives in one group, so the whole ship shares a yaw
    const ship = new THREE.Group();
    ship.position.set(x, deck, z);
    ship.rotation.y = YAW;
    props.add(ship);

    // hull: side profile — raised stern, dipping sheer, rising bow — swept
    // across the beam with a rounded bevel. Local x is along the ship.
    {
      const s = new THREE.Shape();
      s.moveTo(-7.0, 0.15);
      s.quadraticCurveTo(-7.6, -0.9, -6.6, -2.1);    // stern rake
      s.quadraticCurveTo(0, -3.0, 5.4, -2.2);        // keel run
      s.quadraticCurveTo(7.2, -1.6, 8.1, 0.4);       // bow curve up
      s.lineTo(7.0, 0.5);                            // sheer, bow...
      s.quadraticCurveTo(0, -0.4, -5.8, 0.35);       // ...dipping midship
      s.lineTo(-7.0, 0.15);
      const geo = new THREE.ExtrudeGeometry(s, {
        depth: 2.6, bevelEnabled: true, bevelThickness: 0.8, bevelSize: 0.7, bevelSegments: 3, steps: 1,
      });
      geo.translate(0, 0, -1.3);
      const hull = new THREE.Mesh(geo, hullMat);
      hull.castShadow = true;
      ship.add(hull);
      // wales: two rub-rails sweeping the sheer line on each side
      for (const side of [-1, 1]) {
        for (const [wy0, wy1] of [[-0.15, 0.1], [-1.05, -0.8]]) {
          tube([
            [x - 7.0 + Math.sin(YAW), deck + wy0 + 0.2, z + side * 2.05],
            [x - 2.0, deck + wy0 - 0.15, z + side * 2.28],
            [x + 3.5, deck + (wy0 + wy1) / 2, z + side * 2.15],
            [x + 7.6, deck + wy1 + 0.7, z + side * 1.2],
          ], 0.09, woodDarkMat, 20);
        }
      }
    }

    // bulwark railing round the deck: posts instanced, rails as tubes
    {
      const post = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.06, 0.55, 6), woodDarkMat, 18);
      const d = new THREE.Object3D();
      let n = 0;
      for (let i = 0; i < 9; i++) {
        const t = i / 8;
        const lx = -6.2 + t * 12.4;
        for (const side of [-1, 1]) {
          d.position.set(lx, 0.28, side * 2.1);
          d.updateMatrix();
          post.setMatrixAt(n++, d.matrix);
        }
      }
      post.count = n;
      ship.add(post);
      for (const side of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 12.6, 6), woodMat);
        rail.position.set(0, 0.55, side * 2.1);
        rail.rotation.z = Math.PI / 2;
        ship.add(rail);
      }
    }

    // stern castle dressing: gold trim and three glowing cabin windows
    {
      const trim = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.14, 4.2), goldMat);
      trim.position.set(-4.6, 1.62, -0.2);
      ship.add(trim);
      for (let i = -1; i <= 1; i++) {
        const win = new THREE.Mesh(new THREE.CircleGeometry(0.22, 10), glowCoralMat);
        win.position.set(-6.35, 0.9, -0.2 + i * 1.1);
        win.rotation.y = -Math.PI / 2;
        ship.add(win);
      }
    }

    // bow: bowsprit, jib sail, and the cyclops figurehead
    {
      const sprit = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, 4.2, 7), woodDarkMat);
      sprit.position.set(9.2, 0.9, 0);
      sprit.rotation.z = -1.25;
      ship.add(sprit);
      // jib: a triangle strung under the bowsprit
      const jibShape = new THREE.Shape();
      jibShape.moveTo(0, 0); jibShape.lineTo(3.2, 1.4); jibShape.lineTo(0.4, 2.6); jibShape.closePath();
      const jib = new THREE.Mesh(new THREE.ShapeGeometry(jibShape), sailMat);
      jib.position.set(7.2, 0.6, 0.02);
      jib.rotation.y = 0.06;
      ship.add(jib);
      // figurehead: a one-eyed lookout, forever staring at the horizon
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 10), capMat);
      head.position.set(8.35, 0.35, 0);
      ship.add(head);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8), new THREE.MeshBasicMaterial({ color: 0xfdf7ea }));
      eye.position.set(8.75, 0.42, 0);
      ship.add(eye);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 6), new THREE.MeshBasicMaterial({ color: 0x1a1420 }));
      pupil.position.set(8.87, 0.42, 0);
      ship.add(pupil);
      for (const side of [-1, 1]) {
        const arm = new THREE.Mesh(new THREE.ConeGeometry(0.14, 1.1, 7), capMat);
        arm.position.set(8.1, -0.35, side * 0.32);
        arm.rotation.x = side * 0.7;
        arm.rotation.z = 2.6;
        ship.add(arm);
      }
    }

    // masts, tops, yards, billowed sails, rigging, and the colours
    const flagTex = jollyRogerTexture();
    for (const [mx, mh, sailW] of [[2.2, 11, 4.6], [-2.4, 9, 3.8]]) {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.22, mh, 8), woodDarkMat);
      mast.position.set(mx, mh / 2, 0);
      mast.castShadow = true;
      ship.add(mast);
      // the top: a little crow's-nest ring
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.34, 0.3, 9), woodMat);
      top.position.set(mx, mh * 0.62, 0);
      ship.add(top);
      const yard = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, sailW + 0.8, 6), woodDarkMat);
      yard.position.set(mx, mh * 0.78, 0);
      yard.rotation.x = Math.PI / 2;
      ship.add(yard);
      // the sail: a partial cylinder, so it BILLOWS — full ahead of the mast
      const sail = new THREE.Mesh(
        new THREE.CylinderGeometry(2.6, 2.6, sailW, 14, 1, true, -0.62, 1.24),
        sailMat
      );
      sail.position.set(mx - 2.0, mh * 0.47, 0);
      sail.rotation.z = Math.PI / 2;
      sail.rotation.y = Math.PI / 2;
      sail.scale.y = 1; // (height axis is along the yard after rotation)
      ship.add(sail);
      // shrouds: two stays per side from masthead to the rail
      for (const side of [-1, 1]) {
        for (const dxs of [-0.7, 0.7]) {
          const a = new THREE.Vector3(mx, mh * 0.86, 0);
          const b = new THREE.Vector3(mx + dxs, 0.55, side * 2.0);
          const len = a.distanceTo(b);
          const stay = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, len, 4), ropeMat);
          stay.position.copy(a).lerp(b, 0.5);
          stay.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
          ship.add(stay);
        }
      }
      anchor(x + Math.cos(YAW) * mx, deck + mh * 0.78, z - Math.sin(YAW) * mx, 'swing');
    }
    // forestay and backstay tie the silhouette together
    tube([[x + 2.2, deck + 10.8, z], [x + 9.6, deck + 2.6, z]], 0.03, ropeMat, 8);
    tube([[x - 2.4, deck + 8.8, z], [x - 7.2, deck + 1.8, z]], 0.03, ropeMat, 8);
    // the colours, snapping in a wind that isn't there
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.15, 8, 1),
      new THREE.MeshBasicMaterial({ map: flagTex, side: THREE.DoubleSide }));
    flag.position.set(2.2 + 0.85, 11.55, 0);
    flag.userData.openAnim = (dt) => {
      flag.userData.t = (flag.userData.t || 0) + dt;
      const pos = flag.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const px = pos.getX(i);
        pos.setZ(i, Math.sin(px * 2.4 - flag.userData.t * 6) * 0.09 * (px + 0.85));
      }
      pos.needsUpdate = true;
    };
    animated.push(flag);
    ship.add(flag);

    // THE JETS: three downward thrusters on struts — the reason it flies.
    // Bell, ring-fin, and a flame cone that flickers every frame.
    for (const [jx, jz] of [[4.2, 1.1], [4.2, -1.1], [-4.8, 0]]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.0, 0.18), metalMat);
      strut.position.set(jx, -2.6, jz);
      ship.add(strut);
      const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.62, 1.0, 10), metalMat);
      bell.position.set(jx, -3.4, jz);
      bell.castShadow = true;
      ship.add(bell);
      const fin = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.07, 6, 12), goldMat);
      fin.position.set(jx, -3.15, jz);
      fin.rotation.x = Math.PI / 2;
      ship.add(fin);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.6, 9),
        new THREE.MeshBasicMaterial({ color: GLOW_CYAN, transparent: true, opacity: 0.85, depthWrite: false }));
      flame.position.set(jx, -4.6, jz);
      flame.rotation.x = Math.PI;
      const core = new THREE.Mesh(new THREE.ConeGeometry(0.2, 1.0, 8),
        new THREE.MeshBasicMaterial({ color: 0xeafcff, transparent: true, opacity: 0.9, depthWrite: false }));
      core.position.set(0, -0.2, 0);
      flame.add(core);
      const seed = rand(0, TAU);
      flame.userData.openAnim = (dt) => {
        flame.userData.t = (flame.userData.t || seed) + dt;
        const k = 0.85 + Math.sin(flame.userData.t * 21) * 0.12 + Math.sin(flame.userData.t * 47) * 0.06;
        flame.scale.set(1, k, 1);
        flame.material.opacity = 0.6 + k * 0.3;
      };
      animated.push(flame);
      ship.add(flame);
    }

    // deck furniture: lanterns, the helm, and the captain's chest
    for (const [lx, lz] of [[6.2, 0.8], [-6.0, -0.4]]) {
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), glowCoralMat);
      lamp.position.set(lx, 1.2, lz);
      ship.add(lamp);
      const cage = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.02, 5, 10), metalMat);
      cage.position.copy(lamp.position);
      ship.add(cage);
    }
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.07, 8, 14), goldMat);
    wheel.position.set(x - 3.4, deck + 2.4, z - 0.2);
    wheel.rotation.y = Math.PI / 2 + YAW;
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
      }
      // no pilings — these spars FLOAT, held by a shard of the same stuff
      // that keeps the slabs up
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
    // a tuft of moss on top, so even the far rocks read alive
    const tuft = new THREE.Mesh(new THREE.ConeGeometry(fr * 0.16, fr * 0.5, 5), tealMat);
    tuft.position.set(fx, fy + fr * 0.9, fz);
    props.add(tuft);
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
    // a second, sparser layer of BIG stars — the ones you'd name
    const N2 = 60;
    const pos2 = new Float32Array(N2 * 3);
    for (let i = 0; i < N2; i++) {
      const u = rand(0.05, 1), a = rand(0, TAU);
      const r = Math.sqrt(1 - u * u) * 855;
      pos2[i * 3] = Math.cos(a) * r; pos2[i * 3 + 1] = u * 855; pos2[i * 3 + 2] = Math.sin(a) * r;
    }
    const bigGeo = new THREE.BufferGeometry();
    bigGeo.setAttribute('position', new THREE.BufferAttribute(pos2, 3));
    const bigStars = new THREE.Points(bigGeo, new THREE.PointsMaterial({
      size: 4.5, sizeAttenuation: false, color: 0xf2ecff,
      transparent: true, opacity: 0.95, fog: false, depthWrite: false,
    }));
    bigStars.frustumCulled = false;
    scene.add(bigStars);

    // the gas giant: banded, ringed, one raging storm, its own little moon
    const planet = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(55, 28, 20), new THREE.MeshBasicMaterial({ color: 0xd98e5f, fog: false }));
    planet.add(body);
    for (const [by, bc, br] of [[-24, 0xc27a55, 49], [-14, 0xb56a48, 53.5], [-2, 0xe0a070, 54.8], [6, 0xc77a52, 54.2], [16, 0xb56a48, 52], [24, 0xb56a48, 50]]) {
      const band = new THREE.Mesh(new THREE.SphereGeometry(br, 24, 6), new THREE.MeshBasicMaterial({ color: bc, fog: false }));
      band.scale.y = 0.10;
      band.position.y = by;
      planet.add(band);
    }
    // the storm: a pale oval, off-centre, like the eye that never blinks
    const storm = new THREE.Mesh(new THREE.SphereGeometry(9, 12, 10), new THREE.MeshBasicMaterial({ color: 0xf2d8b8, fog: false }));
    storm.scale.set(1.6, 0.8, 0.5);
    storm.position.set(-30, -8, 44);
    planet.add(storm);
    // double rings: a bright inner sheet, a faint outer one, with a gap
    for (const [r0, r1, op] of [[66, 84, 0.85], [88, 102, 0.4]]) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 44), new THREE.MeshBasicMaterial({
        color: 0xf0d8a8, fog: false, side: THREE.DoubleSide, transparent: true, opacity: op,
      }));
      ring.rotation.x = Math.PI / 2 - 0.35;
      planet.add(ring);
    }
    const giantMoon = new THREE.Mesh(new THREE.SphereGeometry(6, 12, 10), new THREE.MeshBasicMaterial({ color: 0xd8b8d0, fog: false }));
    giantMoon.position.set(85, 40, 20);
    planet.add(giantMoon);
    planet.position.set(300, 120, -520);
    planet.rotation.z = -0.12;
    scene.add(planet);

    // a small chalky moon on the other flank, and a far teal world
    const moon = new THREE.Mesh(new THREE.SphereGeometry(16, 18, 14), new THREE.MeshBasicMaterial({ color: 0xcdd6e8, fog: false }));
    moon.position.set(-420, 190, -260);
    scene.add(moon);
    const tealWorld = new THREE.Mesh(new THREE.SphereGeometry(10, 14, 12), new THREE.MeshBasicMaterial({ color: 0x66c9c0, fog: false }));
    tealWorld.position.set(-180, 70, 640);
    scene.add(tealWorld);

    // (the nebula clouds and galaxy band are painted into the sky DOME —
    // see the theme's sky config in main.js. Screen-size transparent
    // sprites cost a full screen of blending each; the dome is free.)
  }

  // ── casks: lathe-turned, staved, glow-hooped — and still breakable ───────
  const loose = [];
  const caskProfile = [];
  for (const [py, pr] of [[-0.6, 0.34], [-0.5, 0.44], [-0.25, 0.53], [0, 0.56], [0.25, 0.53], [0.5, 0.44], [0.6, 0.34]]) {
    caskProfile.push(new THREE.Vector2(pr, py));
  }
  const caskGeo = new THREE.LatheGeometry(caskProfile, 14);
  const caskSpots = [[6, 4], [7.5, 6], [-10, 10], [24, 14], [-2, -14], [13, -2]];
  for (const [bx, bz] of caskSpots) {
    const base = g(bx, bz);
    const cask = new THREE.Group();
    const body = new THREE.Mesh(caskGeo, caskBodyMat);
    body.castShadow = true;
    cask.add(body);
    // lids, so the ends aren't hollow
    for (const ly of [-0.6, 0.6]) {
      const lid = new THREE.Mesh(new THREE.CircleGeometry(0.34, 12), woodDarkMat);
      lid.position.y = ly;
      lid.rotation.x = ly > 0 ? -Math.PI / 2 : Math.PI / 2;
      cask.add(lid);
    }
    for (const by of [-0.42, 0, 0.42]) {
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(by === 0 ? 0.575 : 0.51, 0.045, 6, 16), glowCyanMat);
      hoop.position.y = by;
      hoop.rotation.x = Math.PI / 2;
      cask.add(hoop);
    }
    // a little spigot with a drip of glow
    const spigot = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.2, 6), metalMat);
    spigot.position.set(0.58, -0.2, 0);
    spigot.rotation.z = Math.PI / 2;
    cask.add(spigot);
    const drip = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), glowCyanMat);
    drip.position.set(0.68, -0.28, 0);
    cask.add(drip);
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
    const bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.85, 1.0), deckMat);
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
// stardust sparkles ride the swell, and a sister galleon crosses the southern
// horizon on a very long watch.
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

  // stardust: sparkles riding the swell around wherever the player is looking
  const DUST = 220;
  const dustPos = new Float32Array(DUST * 3);
  const dustSeed = new Float32Array(DUST * 2);
  for (let i = 0; i < DUST; i++) {
    dustSeed[i * 2] = rand(0, TAU);          // phase
    dustSeed[i * 2 + 1] = rand(8, 95);       // radius from origin
    const a = rand(0, TAU);
    dustPos[i * 3] = Math.cos(a) * dustSeed[i * 2 + 1];
    dustPos[i * 3 + 2] = Math.sin(a) * dustSeed[i * 2 + 1];
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
    color: 0xd8ccff, size: 0.16, sizeAttenuation: true,
    transparent: true, opacity: 0.8, depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  dust.frustumCulled = false;
  group.add(dust);

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
          // Spawn ON the far dome and fly TANGENT to it, so a comet can never
          // dive at the camera — a screen-filling transparent cone is a frame
          // spike on any GPU, and it looks wrong besides: comets belong to
          // the sky, not the play space.
          const a = rand(0, TAU);
          c.from.set(Math.cos(a) * 620, rand(200, 330), Math.sin(a) * 620);
          c.vel.set(-Math.sin(a), rand(-0.25, -0.1), Math.cos(a)).normalize().multiplyScalar(150);
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
      // stardust rides the swell and twinkles as a body
      {
        const pos = dust.geometry.attributes.position;
        for (let i = 0; i < DUST; i++) {
          const x = pos.getX(i), z = pos.getZ(i);
          pos.setY(i, water.heightAt(x, z) + 0.12 + Math.sin(time * 1.7 + dustSeed[i * 2]) * 0.08);
        }
        pos.needsUpdate = true;
        dust.material.opacity = 0.55 + Math.sin(time * 2.3) * 0.25;
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
