// The title vignette: a 2D cartoon painted with 3D pieces.
//
// One caricature island, a palm, a half-buried chest, a trader on the
// horizon, gulls, clouds, a ray-burst sun — drawn as FLAT SHAPES
// (ShapeGeometry + unlit MeshBasicMaterial, the vector look), viewed through
// an ORTHOGRAPHIC camera pointed dead level. No perspective, no camera
// motion, no depth cues except layer order — the frame reads as animation-cel
// 2D, on purpose. The one exception is the character herself: the real
// cel-shaded rig idling mid-frame, which is what stitches the poster to the
// game it opens.
//
// Everything animates a little — waves slide, the boat rolls, the palm
// sways, gulls flap by, the burst turns — and the CAMERA does nothing at all.

import * as THREE from '../../vendor/three/three.module.js';
import { rand, TAU } from '../core/math.js';

// The palette leans on the game's own sea/sand/leaf colours so the cut from
// vignette to world feels like waking up inside the poster.
const C = {
  skyTop: 0x3f92e0,
  skyLow: 0xa8dcf5,
  raysA: 0xffffff,
  sun: 0xfff3c4,
  sea: 0x2f9fc4,
  waveBack: 0x66d6da,
  waveMid: 0x3cb9c6,
  waveFront: 0x2596ab,
  waveDeep: 0x1d7f95,
  sand: 0xf0dca2,
  sandEdge: 0xdec488,
  grass: 0x6fce62,
  trunk: 0x8a5a33,
  leaf: 0x3fae4f,
  leafDark: 0x2f8f42,
  wood: 0x7a4f2c,
  woodDark: 0x5d3a1f,
  gold: 0xf2c14e,
  ship: 0x263447,
  sail: 0xe8e2d0,
  gull: 0xfdfdf8,
  cloud: 0xffffff,
  shadow: 0x1c3a4a,
};

function flat(geoOrShape, color, x, y, z, opts = {}) {
  const geo = geoOrShape.isBufferGeometry ? geoOrShape : new THREE.ShapeGeometry(geoOrShape, opts.curveSegments ?? 16);
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: opts.opacity != null,
    opacity: opts.opacity ?? 1,
    side: THREE.DoubleSide,
    fog: false,
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

// A long strip whose top edge is a run of scallops. Drifting it by exactly
// one scallop wavelength wraps seamlessly.
function waveStrip(width, step, amp, depth) {
  const s = new THREE.Shape();
  const bumps = Math.ceil(width / step);
  s.moveTo(-width / 2, -depth);
  s.lineTo(-width / 2, 0);
  for (let i = 0; i < bumps; i++) {
    const x0 = -width / 2 + i * step;
    s.quadraticCurveTo(x0 + step / 2, amp, x0 + step, 0);
  }
  s.lineTo(width / 2, -depth);
  s.closePath();
  return s;
}

// A cartoon cloud: three arcs on a flat keel.
function cloudShape(w) {
  const s = new THREE.Shape();
  const h = w * 0.28;
  s.moveTo(-w / 2, 0);
  s.absarc(-w * 0.28, 0, w * 0.22, Math.PI, Math.PI * 0.35, true);
  s.absarc(0, h * 0.35, w * 0.28, Math.PI * 0.8, Math.PI * 0.15, true);
  s.absarc(w * 0.28, 0, w * 0.22, Math.PI * 0.7, 0, true);
  s.lineTo(w / 2, 0);
  s.closePath();
  return s;
}

// The classic two-arc gull glyph, with a little stroke thickness.
function gullShape(w) {
  const s = new THREE.Shape();
  const h = w * 0.30, t = w * 0.10;
  s.moveTo(-w / 2, 0);
  s.quadraticCurveTo(-w / 4, h, 0, h * 0.12);
  s.quadraticCurveTo(w / 4, h, w / 2, 0);
  s.quadraticCurveTo(w / 4, h - t, 0, -t * 0.4);
  s.quadraticCurveTo(-w / 4, h - t, -w / 2, 0);
  s.closePath();
  return s;
}

export class TitleVignette {
  constructor() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(C.skyTop);
    this.scene = scene;

    this.camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 140);
    this.camera.position.set(0, 2.2, 50);
    this.camera.lookAt(0, 2.2, 0);

    this._anim = [];
    const anim = (fn) => this._anim.push(fn);

    // ── sky bands ─────────────────────────────────────────────────────────
    scene.add(flat(new THREE.PlaneGeometry(90, 3.4), 0x6fb5ec, 0, 3.6, -46));
    scene.add(flat(new THREE.PlaneGeometry(90, 1.6), C.skyLow, 0, 2.3, -45));

    // ── the ray burst, centred behind her like the poster it is ───────────
    {
      const shapes = [];
      const RAYS = 14, R = 46;
      for (let i = 0; i < RAYS; i++) {
        const a0 = (i / RAYS) * TAU, a1 = a0 + (TAU / RAYS) * 0.5;
        const s = new THREE.Shape();
        s.moveTo(0, 0);
        s.lineTo(Math.cos(a0) * R, Math.sin(a0) * R);
        s.lineTo(Math.cos(a1) * R, Math.sin(a1) * R);
        s.closePath();
        shapes.push(s);
      }
      const burst = flat(new THREE.ShapeGeometry(shapes, 2), C.raysA, 0, 2.3, -44, { opacity: 0.10 });
      scene.add(burst);
      anim((dt, t) => { burst.rotation.z = t * 0.02; });
    }

    // ── sun, up and out of the logo's way ─────────────────────────────────
    {
      const halo = flat(new THREE.CircleGeometry(1.35, 40), C.sun, -6.4, 5.6, -43, { opacity: 0.35 });
      const disc = flat(new THREE.CircleGeometry(0.95, 40), C.sun, -6.4, 5.6, -42);
      scene.add(halo, disc);
      anim((dt, t) => { halo.scale.setScalar(1 + Math.sin(t * 0.8) * 0.05); });
    }

    // ── clouds ────────────────────────────────────────────────────────────
    for (const [w, x, y, z, sp, op] of [
      [3.0, -6, 4.6, -40, 0.14, 0.95],
      [2.1, 5.5, 5.6, -41, 0.10, 0.9],
      [2.6, 1.5, 7.6, -40, 0.12, 0.95],
      [2.0, -4, 9.6, -41, 0.09, 0.9],
    ]) {
      const cl = flat(cloudShape(w), C.cloud, x, y, z, { opacity: op });
      scene.add(cl);
      anim((dt, t) => {
        cl.position.x += sp * dt;
        if (cl.position.x > 13) cl.position.x = -13;
      });
    }

    // ── gulls ─────────────────────────────────────────────────────────────
    for (const [w, x, y, z, sp] of [
      [0.75, -3, 4.9, -38, 0.5],
      [0.6, -4.5, 5.5, -38, 0.42],
      [0.66, 4, 6.4, -38, -0.36],
      [0.56, 2, 8.6, -38, -0.3],
    ]) {
      const g = flat(gullShape(w), C.gull, x, y, z);
      scene.add(g);
      const ph = rand(0, TAU);
      anim((dt, t) => {
        g.position.x += sp * dt;
        if (g.position.x > 12) g.position.x = -12;
        if (g.position.x < -12) g.position.x = 12;
        g.scale.y = 1 + Math.sin(t * 7 + ph) * 0.3;  // the flap is a squash
        g.position.y += Math.sin(t * 1.3 + ph) * 0.002;
      });
    }

    // ── the sea: a deep band and three sliding scallop strips ─────────────
    scene.add(flat(new THREE.PlaneGeometry(90, 24), C.sea, 0, 1.55 - 12, -30));
    const STEPW = 2.4;
    for (const [top, z, colr, sp, amp] of [
      [1.45, -16, C.waveBack, 0.22, 0.10],
      [0.55, 2.5, C.waveMid, -0.30, 0.14],
      [-0.55, 5, C.waveFront, 0.40, 0.18],
      [-2.2, 6, C.waveDeep, -0.26, 0.22],
    ]) {
      const wv = flat(waveStrip(34, STEPW, amp, 14), colr, 0, top, z);
      scene.add(wv);
      anim((dt, t) => {
        wv.position.x = ((t * sp) % STEPW + STEPW) % STEPW - STEPW;
        wv.position.y = top + Math.sin(t * 0.9 + top * 3) * 0.05;
      });
    }

    // ── the trader on the horizon ─────────────────────────────────────────
    {
      const ship = new THREE.Group();
      const hull = new THREE.Shape();
      hull.moveTo(-1.5, 0.42); hull.lineTo(1.55, 0.42);
      hull.quadraticCurveTo(1.35, -0.05, 0.95, -0.32);
      hull.lineTo(-1.15, -0.32);
      hull.quadraticCurveTo(-1.65, 0.05, -1.5, 0.42);
      hull.closePath();
      ship.add(flat(hull, C.ship, 0, 0, 0));
      // stern castle
      ship.add(flat(new THREE.PlaneGeometry(0.62, 0.34), C.ship, -1.15, 0.55, 0));
      // masts
      ship.add(flat(new THREE.PlaneGeometry(0.07, 1.6), C.ship, 0.45, 1.1, 0));
      ship.add(flat(new THREE.PlaneGeometry(0.06, 1.3), C.ship, -0.55, 0.95, 0));
      // sails: fat triangles, wind-bellied
      const sail = (wd, ht) => {
        const s = new THREE.Shape();
        s.moveTo(-wd / 2, 0); s.lineTo(wd / 2, 0);
        s.quadraticCurveTo(wd * 0.42, ht * 0.55, 0, ht);
        s.quadraticCurveTo(-wd * 0.42, ht * 0.55, -wd / 2, 0);
        s.closePath();
        return s;
      };
      ship.add(flat(sail(1.0, 1.05), C.sail, 0.45, 0.62, 0.01));
      ship.add(flat(sail(0.8, 0.85), C.sail, -0.55, 0.6, 0.01));
      // pennant
      ship.add(flat(new THREE.PlaneGeometry(0.3, 0.12), 0x1c2635, 0.62, 1.92, 0.01));
      ship.position.set(4.6, 1.55, -18);
      ship.scale.setScalar(1.15);
      scene.add(ship);
      anim((dt, t) => {
        ship.rotation.z = Math.sin(t * 0.6) * 0.035;
        ship.position.y = 1.52 + Math.sin(t * 0.85) * 0.06;
      });
    }

    // ── the island: a sand mound with a grass cap ─────────────────────────
    {
      const mound = new THREE.Shape();
      mound.moveTo(-3.1, -0.5);
      mound.quadraticCurveTo(-2.9, 0.9, -1.6, 1.35);
      mound.quadraticCurveTo(0, 1.95, 1.7, 1.3);
      mound.quadraticCurveTo(2.95, 0.85, 3.1, -0.5);
      mound.closePath();
      scene.add(flat(mound, C.sandEdge, 0, 0, -0.05));
      const mound2 = new THREE.Shape();
      mound2.moveTo(-2.95, -0.5);
      mound2.quadraticCurveTo(-2.75, 0.8, -1.55, 1.25);
      mound2.quadraticCurveTo(0, 1.82, 1.65, 1.2);
      mound2.quadraticCurveTo(2.8, 0.76, 2.95, -0.5);
      mound2.closePath();
      scene.add(flat(mound2, C.sand, 0, 0, 0));
      // grass cap, slightly off-centre like a bad haircut
      const cap = new THREE.Shape();
      cap.moveTo(-1.7, 1.16);
      cap.quadraticCurveTo(-0.9, 1.78, 0.15, 1.8);
      cap.quadraticCurveTo(1.15, 1.78, 1.75, 1.12);
      cap.quadraticCurveTo(0.9, 1.5, 0.1, 1.52);
      cap.quadraticCurveTo(-0.95, 1.5, -1.7, 1.16);
      cap.closePath();
      scene.add(flat(cap, C.grass, 0, 0.06, 0.05));
    }

    // ── the palm, leaning in from the left ────────────────────────────────
    {
      const palm = new THREE.Group();
      const trunk = new THREE.Shape();
      trunk.moveTo(-0.14, 0);
      trunk.quadraticCurveTo(-0.05, 1.2, 0.75, 2.3);
      trunk.quadraticCurveTo(0.83, 2.4, 0.95, 2.32);
      trunk.quadraticCurveTo(0.28, 1.15, 0.2, 0);
      trunk.closePath();
      palm.add(flat(trunk, C.trunk, 0, 0, 0));
      // fronds: fat teardrops fanned around the crown
      const frond = (len) => {
        const s = new THREE.Shape();
        s.moveTo(0, 0);
        s.quadraticCurveTo(len * 0.45, len * 0.34, len, len * 0.10);
        s.quadraticCurveTo(len * 0.5, len * 0.02, 0, -len * 0.06);
        s.closePath();
        return s;
      };
      const crown = new THREE.Group();
      crown.position.set(0.88, 2.34, 0.02);
      for (const [a, len, colr] of [
        [0.55, 1.25, C.leaf], [0.1, 1.45, C.leafDark], [-0.4, 1.35, C.leaf],
        [2.6, 1.2, C.leafDark], [3.0, 1.35, C.leaf], [-1.1, 1.1, C.leafDark],
      ]) {
        const f = flat(frond(len), colr, 0, 0, 0.01 * a);
        f.rotation.z = a;
        crown.add(f);
      }
      // coconuts
      crown.add(flat(new THREE.CircleGeometry(0.10, 12), C.woodDark, 0.05, -0.06, 0.08));
      crown.add(flat(new THREE.CircleGeometry(0.09, 12), C.woodDark, -0.12, 0.02, 0.08));
      palm.add(crown);
      palm.position.set(-2.15, 0.9, 0.1);
      scene.add(palm);
      anim((dt, t) => {
        palm.rotation.z = Math.sin(t * 0.7) * 0.022;
        crown.rotation.z = Math.sin(t * 1.1 + 1) * 0.03;
      });
    }

    // ── the chest, half-buried, leaking gold ──────────────────────────────
    {
      const chest = new THREE.Group();
      const base = new THREE.Shape();
      base.moveTo(-0.5, 0); base.lineTo(0.5, 0);
      base.lineTo(0.46, 0.42); base.lineTo(-0.46, 0.42);
      base.closePath();
      chest.add(flat(base, C.wood, 0, 0, 0));
      const lid = new THREE.Shape();
      lid.moveTo(-0.5, 0.42); lid.lineTo(0.5, 0.42);
      lid.quadraticCurveTo(0.52, 0.75, 0, 0.78);
      lid.quadraticCurveTo(-0.52, 0.75, -0.5, 0.42);
      lid.closePath();
      chest.add(flat(lid, C.woodDark, 0, 0.02, 0.01));
      chest.add(flat(new THREE.PlaneGeometry(0.1, 0.44), C.woodDark, -0.18, 0.21, 0.02));
      chest.add(flat(new THREE.PlaneGeometry(0.1, 0.44), C.woodDark, 0.18, 0.21, 0.02));
      chest.add(flat(new THREE.CircleGeometry(0.075, 12), C.gold, 0, 0.44, 0.03));
      // half-buried: tipped, sunk into the sand line
      chest.position.set(1.55, 0.75, 0.35);
      chest.rotation.z = -0.22;
      scene.add(chest);
      // spilled coins
      for (const [cx, cy] of [[1.1, 0.72], [2.05, 0.62], [1.85, 0.5]]) {
        scene.add(flat(new THREE.CircleGeometry(0.07, 12), C.gold, cx, cy, 0.4));
      }
    }

    // ── a planted jolly roger, because caricature ─────────────────────────
    {
      const flagG = new THREE.Group();
      flagG.add(flat(new THREE.PlaneGeometry(0.055, 1.15), C.woodDark, 0, 0.55, 0));
      const banner = flat(new THREE.PlaneGeometry(0.72, 0.44), 0x232030, 0.39, 0.94, 0.01);
      flagG.add(banner);
      const skull = flat(new THREE.CircleGeometry(0.075, 12), 0xf0e6cf, 0.34, 0.96, 0.02);
      flagG.add(skull);
      flagG.position.set(-1.15, 1.1, 0.3);
      flagG.rotation.z = 0.10;
      scene.add(flagG);
      anim((dt, t) => {
        banner.scale.y = 1 + Math.sin(t * 3.1) * 0.06;
        banner.rotation.z = Math.sin(t * 2.2) * 0.05;
        skull.position.x = 0.34 + Math.sin(t * 2.2) * 0.02;
      });
    }

    // ── flat blob shadows, the 2D-animation kind ──────────────────────────
    for (const [sx, sy, w, o] of [[0.15, 1.45, 1.15, 0.16], [1.6, 0.68, 0.85, 0.13], [-2.2, 0.86, 0.8, 0.12]]) {
      const sh = flat(new THREE.CircleGeometry(0.5, 20), C.shadow, sx, sy, 0.15, { opacity: o });
      sh.scale.set(w / 0.5, 0.22, 1);
      scene.add(sh);
    }

    // ── light, for the one real 3D thing in the frame ─────────────────────
    // Brighter than the game's rig on purpose: this is a poster, and she is
    // standing in flat noon colour next to unlit vector shapes.
    const hemi = new THREE.HemisphereLight(0xcfeeff, 0x86b8a8, 1.25);
    const key = new THREE.DirectionalLight(0xfff3d8, 1.9);
    key.position.set(-6, 10, 16);
    scene.add(hemi, key);

    // ── the character stub: what the model reads instead of a controller ──
    this._actor = {
      position: new THREE.Vector3(0.05, 1.52, 0.6),
      facing: 0.35,
      state: 'ground', grounded: true, inWater: false,
      speedRatio: 0, gaitPhase: 0,
      velocity: new THREE.Vector3(),
      intent: new THREE.Vector2(),
      meleeTimer: 0, meleeStage: 0, meleeDuration: 0.32,
    };
    this._char = null;
  }

  /** Drop the loaded character model into the frame. */
  setCharacter(model) {
    this._char = model;
    model.object3D.scale.setScalar(1.35);   // poster scale, not simulation scale
    this.scene.add(model.object3D);
  }

  update(dt, t) {
    for (const fn of this._anim) fn(dt, t);
    if (this._char) this._char.update(dt, this._actor, { time: t });
  }

  /** Frame the vignette for any aspect: fit width in portrait, height in landscape. */
  resize(aspect) {
    // Frustum extents are RELATIVE TO THE CAMERA, which already sits at the
    // composition's centre height — so the box is symmetric around zero.
    const MIN_W = 10.5, MIN_H = 8.6;
    let h = MIN_W / aspect;
    if (h < MIN_H) h = MIN_H;
    const w = h * aspect;
    this.camera.left = -w / 2;
    this.camera.right = w / 2;
    this.camera.top = h / 2;
    this.camera.bottom = -h / 2;
    // In landscape the DOM logo sits top-centre, right where the palm crown
    // ends up — slide the framing so the island reads left-of-centre and the
    // logo gets open sky. A one-time framing choice, not camera movement.
    this.camera.position.x = aspect > 1.2 ? 1.5 : 0;
    this.camera.updateProjectionMatrix();
  }
}
