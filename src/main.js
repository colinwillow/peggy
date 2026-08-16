// Peggy — entry point.
//
// Boot order matters in one place only: the water needs the renderer (it owns a
// depth target), and the camera needs the level and the water. Everything else
// is independent.

import * as THREE from '../vendor/three/three.module.js';
import { Loop } from './core/loop.js';
import { QUALITY } from './core/quality.js';
import { clamp, clamp01, damp, lerp } from './core/math.js';
import { Input } from './input/Input.js';
import { setupLights, toonMaterial } from './render/toon.js';
import { Sky } from './render/sky.js';
import { Water } from './render/water.js';
import { buildTestIsland } from './world/testIsland.js';
import { buildAmbience } from './world/ambience.js';
import { buildNebulaWorld, buildNebulaAmbience } from './world/nebulaWorld.js';
import { Peggy, State } from './player/Peggy.js';
import { Hook, HookState } from './player/Hook.js';
import { createPeggyModel } from './player/PeggyModel.js';
import { Cannon } from './player/Cannon.js';
import { TitleVignette } from './render/TitleVignette.js';
import { InkPass } from './render/ink.js';
import { FollowCamera } from './camera/FollowCamera.js';

const SUN_DIR = new THREE.Vector3(38, 60, 26).normalize();

// ── worlds ──────────────────────────────────────────────────────────────────
// Two worlds share one engine: the test island (every regression test lives
// there — load it with ?world=island) and the Maroon Nebula, the space-pirate
// world, which is what everyone else gets. A world is a builder plus a theme:
// same sun direction, same physics, different sky.
const WORLD = /[?&]world=island/.test(location.search) ? 'island' : 'nebula';
const THEME = WORLD === 'island' ? {
  fogAir: 0xbfe9ff, fogWater: 0x1a6f8f, fogDensity: 0.0032,
  sky: { top: 0x2f86e0, horizon: 0xcbeeff, sunColor: 0xfff0b8 },
  water: { shallow: 0x5ce9d1, deep: 0x0d64a2, foam: 0xf7feff },
  terrain: {},
  lights: {},
} : {
  // the nebula: a violet dusk lit by a white star, stardust for a sea
  fogAir: 0x271b45, fogWater: 0x1d0f3a, fogDensity: 0.0030,
  sky: {
    top: 0x07051a, horizon: 0x4a2b66, sunColor: 0xd8ecff, bands: 8,
    // clouds and the galaxy live in the dome shader — free, unlike sprites
    nebulas: [
      { dir: [-0.55, 0.28, -0.72], color: 0xc86bf0, power: 9, amp: 0.16 },
      { dir: [0.68, 0.20, -0.62], color: 0x4be8d8, power: 12, amp: 0.10 },
      { dir: [0.45, 0.32, 0.72], color: 0xf25ed3, power: 10, amp: 0.11 },
    ],
    band: { normal: [0.42, 0.62, 0.66], color: 0xd8cfff, power: 14, amp: 0.30 },
  },
  water: { shallow: 0x7c5cf0, deep: 0x140b33, foam: 0xd9c8ff },
  terrain: { wet: 0x8a6bb0, sand: 0xcfa8e8, grass: 0x3fd8c2, rock: 0x5b4a80 },
  lights: {
    keyColor: 0xe8e6ff, keyIntensity: 1.35,
    skyColor: 0x8a7ccf, groundColor: 0x3c2a55, hemiIntensity: 0.72,
    fillColor: 0xff7ec2, fillIntensity: 0.38,
  },
};

// Fog colours for above and below the surface. Swapping these on the camera's
// underwater flag is what makes diving feel like a different place rather than
// the same scene with a blue plane over the lens.
const FOG_AIR = new THREE.Color(THEME.fogAir);
const FOG_WATER = new THREE.Color(THEME.fogWater);

async function boot() {
  const canvas = document.getElementById('game');

  // ── renderer ─────────────────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: QUALITY.antialias, // MSAA is a waste on a retina phone
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, QUALITY.pixelRatio));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(FOG_AIR.getHex(), THEME.fogDensity);

  // Screen-space outlines. ?noink falls back to the raw render.
  const ink = /noink/.test(location.search) ? null : new InkPass(renderer);

  const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 3000);
  camera.position.set(0, 10, 20);

  // ── world ────────────────────────────────────────────────────────────────
  const lights = setupLights(scene, {
    shadowExtent: QUALITY.shadowExtent,
    shadowMapSize: QUALITY.shadowMapSize,
    ...THEME.lights,
  });
  lights.key.position.copy(SUN_DIR).multiplyScalar(90);

  const sky = new Sky(scene, { sunDir: SUN_DIR, ...THEME.sky });
  const water = new Water(scene, renderer, {
    level: 0, sunDir: SUN_DIR,
    size: QUALITY.waterSize,
    segments: QUALITY.waterSegments,
    depthScale: QUALITY.waterDepthScale,
    ...THEME.water,
  });

  const buildWorld = WORLD === 'island' ? buildTestIsland : buildNebulaWorld;
  const { level, props, spawn, loose, stairTops, updateLoose, coins, addCoin, crabs } = buildWorld(scene);
  const ambience = WORLD === 'island' ? buildAmbience(scene, water) : buildNebulaAmbience(scene, water);
  const cannon = new Cannon(scene);

  const terrainMat = toonMaterial({
    color: 0xffffff,
    rimColor: WORLD === 'island' ? 0xfff0c8 : 0xd8b8ff,
    rimStrength: 0.28,
    rimPower: 3.0,
  });
  terrainMat.vertexColors = true;
  const terrain = level.buildTerrainMesh(terrainMat, {
    size: QUALITY.terrainSize,
    segments: QUALITY.terrainSegments,
    palette: THEME.terrain,
  });
  scene.add(terrain);

  // ── player ───────────────────────────────────────────────────────────────
  const peggy = new Peggy(level, water);
  peggy.teleport(spawn.x, spawn.y, spawn.z);

  const model = await createPeggyModel();
  scene.add(model.object3D);
  // The screen-space ink outlines her silhouette at uniform width — better
  // than the geometry shell, which stands down when the pass is on.
  if (ink && model.setInkShell) model.setInkShell(false);

  const follow = new FollowCamera(camera, level, water);
  follow.snapTo(peggy);

  const hook = new Hook(peggy, level, camera);

  // Rope: a single stretched cylinder between hand and hook head. Cheap, and at
  // this art style a taut line reads better than a simulated catenary would.
  const rope = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.035, 1, 6),
    toonMaterial({ color: 0xd9c089, rimStrength: 0.3 })
  );
  rope.visible = false;
  rope.castShadow = true;
  scene.add(rope);

  // ── melee swipe arc ──────────────────────────────────────────────────────
  // A visible ribbon through the swing. Without it the melee is a 0.34s arm
  // rotation on a small character and it genuinely is hard to tell whether the
  // flick registered — which is exactly what got reported.
  //
  // Built as a yawed GROUP containing a tilted ring, rather than one mesh with
  // three Euler angles. Setting .rotation.x and .rotation.z on a single mesh
  // composes in the wrong order — the sweep ended up spinning about the world
  // axis instead of about her, and showed as two slivers either side of her
  // head. A parent for the yaw and a child for the tilt has no such ambiguity.
  const swipePivot = new THREE.Group();
  const swipeGeo = new THREE.RingGeometry(1.45, 2.50, 28, 1, -Math.PI / 2 - 0.85, 1.7);
  const swipeMat = new THREE.MeshBasicMaterial({
    color: 0xfff2c8, transparent: true, opacity: 0, side: THREE.DoubleSide,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const swipe = new THREE.Mesh(swipeGeo, swipeMat);
  swipe.rotation.x = -Math.PI / 2 + 0.30;   // lie it near-flat, tipped forward
  swipePivot.add(swipe);
  swipePivot.visible = false;
  swipe.renderOrder = 20;
  scene.add(swipePivot);

  const hookHead = new THREE.Mesh(
    new THREE.TorusGeometry(0.16, 0.045, 6, 12, Math.PI * 1.4),
    toonMaterial({ color: 0x9aa3ad, rimStrength: 0.9, rimColor: 0xffffff })
  );
  hookHead.visible = false;
  hookHead.castShadow = true;
  scene.add(hookHead);

  // ── the spin finisher's ring (combo stage 3) ─────────────────────────────
  const spinGeo = new THREE.RingGeometry(1.05, 2.9, 40);
  const spinMat = new THREE.MeshBasicMaterial({
    color: 0xffd27a, transparent: true, opacity: 0, side: THREE.DoubleSide,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const spinRing = new THREE.Mesh(spinGeo, spinMat);
  spinRing.rotation.x = -Math.PI / 2;
  spinRing.visible = false;
  spinRing.renderOrder = 20;
  scene.add(spinRing);

  // ── hook aim: trajectory arc + lock-on marker ────────────────────────────
  // The arc is what makes the hold legible: from the moment aim mode engages
  // you can SEE the rope's flight path, watch it snap onto an anchor when the
  // assist locks, and release with confidence. Dashed, so it reads as a
  // prediction rather than as an already-thrown rope.
  const AIM_PTS = 26;
  const aimGeo = new THREE.BufferGeometry();
  aimGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(AIM_PTS * 3), 3));
  const aimLine = new THREE.Line(aimGeo, new THREE.LineDashedMaterial({
    color: 0xffd97a, dashSize: 0.45, gapSize: 0.28,
    transparent: true, opacity: 0.95, depthWrite: false,
  }));
  aimLine.visible = false;
  aimLine.renderOrder = 21;
  aimLine.frustumCulled = false;
  scene.add(aimLine);

  const lockMarker = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.34),
    new THREE.MeshBasicMaterial({ color: 0xffd97a, transparent: true, opacity: 0.95, depthWrite: false })
  );
  lockMarker.visible = false;
  lockMarker.renderOrder = 21;
  scene.add(lockMarker);
  const aimCurve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()
  );
  const aimVec = new THREE.Vector3();
  let aimRefYaw = 0;       // camera yaw frozen at the frame the aim-hold engaged
  let wasAiming = false;
  let shootRefYaw = 0;     // same idea, for the trigger
  let wasShooting = false;
  let shootCd = 0;

  // ── input + hud ──────────────────────────────────────────────────────────
  const dom = {
    canvas,
    zoneL: document.getElementById('zone-left'),
    knobL: document.getElementById('knob-left'),
    ringL: document.getElementById('ring-left'),
    zoneR: document.getElementById('zone-right'),
    knobR: document.getElementById('knob-right'),
    ringR: document.getElementById('ring-right'),
    btnHook: document.getElementById('btn-hook'),
    btnDive: document.getElementById('btn-dive'),
  };
  const input = new Input(dom);

  let gold = 0;
  const hud = {
    gold: document.getElementById('hud-gold'),
    state: document.getElementById('hud-state'),
    speed: document.getElementById('hud-speed'),
    fps: document.getElementById('hud-fps'),
    gesture: document.getElementById('hud-gesture'),
    hint: document.getElementById('hud-hint'),
    prompt: document.getElementById('prompt'),
    promptIcon: document.querySelector('#prompt use'),
    promptLabel: document.querySelector('.prompt-label'),
  };
  let promptTarget = null;
  let promptIconKey = '';
  let hookTarget = null;
  let meleeSwing = null;   // the open strike window: { hit: Set, power }
  document.body.classList.toggle('touch', input.isTouch);

  // ── title screen ─────────────────────────────────────────────────────────
  // The title is a 2D cartoon: a flat, dead-level ORTHOGRAPHIC vignette
  // (TitleVignette.js — caricature island, palm, chest, trader, gulls) with
  // the real cel-shaded character idling in the middle of it, and the logo
  // screen-blended over the top. No camera movement of any kind. The first
  // tap cuts, behind a fast dark curtain, to the spawn beach.
  //
  // While the title holds the screen the world keeps simulating but the
  // PLAYER does not exist: the controller and hook are fed this inert input
  // instead of the real one, so a stray touch can't jump her or throw the
  // hook mid-poster.
  const mkStillBtn = () => ({ down: false, pressed: false, released: false });
  const title = {
    active: false,
    vignette: null,
    el: document.getElementById('title'),
    look: { x: 0, y: 0, dxPx: 0 },
    input: {
      move: { x: 0, y: 0, mag: 0 },
      jump: mkStillBtn(), dive: mkStillBtn(), hook: mkStillBtn(), melee: mkStillBtn(),
      meleeAngle: null,
      hookAim: { active: false, x: 0, y: 0, mag: 0 },
    },
  };

  function startTitle() {
    title.active = true;
    document.body.classList.add('titling');
    title.el.classList.remove('hidden');
    title.vignette = new TitleVignette();
    title.vignette.resize(innerWidth / innerHeight);
    // The vignette gets its own copy of the character (the game's copy can't
    // be in two scenes). Second load hits the browser cache; until it lands
    // the island simply doesn't have her yet.
    createPeggyModel().then((m) => {
      if (title.vignette) title.vignette.setCharacter(m);
    });
  }

  function endTitle() {
    if (!title.active || title.leaving) return;
    title.leaving = true;
    title.el.classList.add('cutting');            // curtain in...
    setTimeout(() => {
      peggy.teleport(spawn.x, spawn.y, spawn.z);  // ...swap the stage...
      follow.snapTo(peggy);
      title.active = false;
      document.body.classList.remove('titling');
      const lg = document.getElementById('title-logo');
      if (lg) lg.classList.remove('on');          // its 0.65s opacity fade runs now
      title.el.classList.add('gone');             // ...curtain (and logo) out
      // Free the vignette: its scene holds GPU buffers the game never uses.
      const v = title.vignette;
      title.vignette = null;
      if (v) {
        v.scene.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
          if (o.material && o.material.isMeshBasicMaterial) o.material.dispose();
        });
      }
      setTimeout(() => {
        title.el.remove();
        const logo = document.getElementById('title-logo');
        if (logo) logo.remove();                  // its own fade ran off .titling
      }, 700);
    }, 300);
  }
  addEventListener('pointerdown', endTitle, true);
  addEventListener('keydown', endTitle, true);

  // ── frame state ──────────────────────────────────────────────────────────
  const _v = new THREE.Vector3();
  const _v2 = new THREE.Vector3();
  let fogT = 0;
  let fps = 60;
  let hudTick = 0;

  function update(dt, time) {
    input.sample(dt);

    // ── context action ─────────────────────────────────────────────────────
    // Interact and jump are the SAME tap. Resolve it here, before the
    // controller sees the press, and consume the edge when something is in
    // range — so a tap next to a chest opens the chest instead of hopping.
    promptTarget = !title.active && peggy.grounded && !hook.active
      ? level.findInteractable(peggy.position, peggy.facing)
      : null;
    if (promptTarget && input.jump.pressed) {
      input.jump.pressed = false;
      promptTarget.used = true;
      promptTarget.onInteract(peggy);
      follow.addTrauma(0.08);
      promptTarget = null;
    }

    // ── hook aim-hold: the twin-stick posture ──────────────────────────────
    // While the hold is active the stick steers the throw, she FACES the held
    // direction, and the camera works its way around behind it — so the hold
    // doubles as a look control: hold forward and pull the move stick back to
    // run backwards, hold right while running left, and so on. The strafe
    // animations key off the same lock.
    //
    // The stick direction is read against the camera yaw FROZEN at the moment
    // the hold engaged. Reading the live yaw would feed back — the camera
    // chases the aim, the aim re-derives from the camera — and a held diagonal
    // would orbit forever instead of settling.
    //
    // The override is set BEFORE hook.update and left in place across the
    // release frame — the stick zeroes on lift, so without the latch every
    // steered throw would revert to the camera heading at the last instant.
    // Hook clears it when it fires.
    const aiming = !title.active && input.hookAim.active;
    if (aiming && !wasAiming) aimRefYaw = follow.yaw;
    wasAiming = aiming;
    if (aiming && input.hookAim.mag > 0.30) {
      const c = Math.cos(aimRefYaw), sn = Math.sin(aimRefYaw);
      const sx = input.hookAim.x, sy = -input.hookAim.y;   // screen y is down
      aimVec.set(sx * c - sy * sn, 0, -sx * sn - sy * c).normalize();
      hook.aimOverride = aimVec;
      peggy.faceLock = Math.atan2(aimVec.x, aimVec.z);
      follow.attract(peggy.faceLock);
    } else if (!aiming && !input.hook.pressed && !hook.active) {
      hook.aimOverride = null;
    }

    // ── the trigger ────────────────────────────────────────────────────────
    // Push the right stick and three things happen at once, immediately: she
    // faces the pushed direction, the camera starts swinging around behind
    // it, and the hand cannon fires — first round instantly, then on a
    // cadence while held. Same frozen-reference-yaw trick as the aim-hold:
    // read the live camera and the chasing camera re-aims the stick forever.
    const shooting = !title.active && input.shoot.active && !hook.active;
    if (shooting && !wasShooting) { shootRefYaw = follow.yaw; shootCd = 0; }
    wasShooting = shooting;
    if (shooting) {
      const c = Math.cos(shootRefYaw), sn = Math.sin(shootRefYaw);
      const sx = input.shoot.x, sy = -input.shoot.y;
      aimVec.set(sx * c - sy * sn, 0, -sx * sn - sy * c).normalize();
      peggy.faceLock = Math.atan2(aimVec.x, aimVec.z);
      follow.attract(peggy.faceLock);
      // Soft lock: a crab or barrel inside the stick's cone gets the gold
      // ring, and shots steer to it — the Robits assist. Nothing centre-screen.
      const lock = peggy.inWater ? (cannon.lockOff(), null)
                                 : cannon.acquire(dt, peggy.position, aimVec, { crabs, loose });
      shootCd -= dt;
      if (shootCd <= 0 && !peggy.inWater) {
        shootCd = 0.18;   // Robits' rocket-class cadence — a stream, not lobs
        if (model.muzzleWorld) model.muzzleWorld(_v);
        else _v.set(peggy.position.x, peggy.position.y + 1.0, peggy.position.z);
        if (lock) _v2.set(lock.x, lock.y, lock.z).sub(_v).normalize();
        else _v2.copy(aimVec);
        cannon.fire(_v, _v2);
        if (model.kick) model.kick();
        follow.addTrauma(0.045);
      }
    } else {
      cannon.lockOff();
    }
    if (!aiming && !shooting) peggy.faceLock = null;

    const drive = title.active ? title.input : input;
    peggy.update(dt, drive.move, drive, follow.yaw);
    if (!title.active && input.recentre.pressed) follow.recentre(peggy);
    hook.update(dt, drive, drive.move);
    follow.update(dt, peggy, title.active ? title.look : input.look);

    // ── aim arc + lock-on ──────────────────────────────────────────────────
    if (aiming && !hook.active) {
      const hand = hook.handPosition(_v);
      const dir = hook.aimDirection(_v2);
      const target = level.findGrapplePoint(hand, dir, 17, 0.28);
      const end = target
        ? (target._latch || target.pos)
        : aimCurve.v2.set(hand.x + dir.x * 9.5, hand.y + 1.2, hand.z + dir.z * 9.5);

      aimCurve.v0.copy(hand);
      aimCurve.v2.copy(end);
      aimCurve.v1.set(
        (hand.x + end.x) / 2,
        Math.max(hand.y, end.y) + 1.6,   // the throw arcs; the line should too
        (hand.z + end.z) / 2
      );
      const pos = aimLine.geometry.attributes.position;
      for (let i = 0; i < AIM_PTS; i++) {
        aimCurve.getPoint(i / (AIM_PTS - 1), _v2);
        pos.setXYZ(i, _v2.x, _v2.y, _v2.z);
      }
      pos.needsUpdate = true;
      aimLine.computeLineDistances();
      aimLine.visible = true;

      if (target) {
        lockMarker.visible = true;
        lockMarker.position.copy(target._latch || target.pos);
        lockMarker.rotation.y += dt * 3.2;
        lockMarker.scale.setScalar(1 + Math.sin(performance.now() * 0.012) * 0.18);
      } else {
        lockMarker.visible = false;
      }
    } else {
      aimLine.visible = false;
      lockMarker.visible = false;
    }

    updateLoose(dt, water);
    for (const crab of crabs) crab.update(dt, peggy);

    // ── the melee strike window ────────────────────────────────────────────
    // Runs every frame of the swing (past the wind-up), each target once.
    if (peggy.meleeTimer > 0 && meleeSwing) {
      const t = 1 - peggy.meleeTimer / (peggy.meleeDuration || 0.32);
      if (t > 0.12) {
        for (const h of loose) {
          if (h.held || h.dead || meleeSwing.hit.has(h)) continue;
          if (!peggy.meleeHits(h.position.x, h.position.y, h.position.z)) continue;
          meleeSwing.hit.add(h);
          const dx = h.position.x - peggy.position.x, dz = h.position.z - peggy.position.z;
          const d = Math.hypot(dx, dz) || 1;
          h.hit(dx / d, dz / d, meleeSwing.power);
          follow.addTrauma(0.14);
        }
        for (const crab of crabs) {
          if (crab.dead || meleeSwing.hit.has(crab)) continue;
          if (!peggy.meleeHits(crab.position.x, crab.position.y, crab.position.z)) continue;
          meleeSwing.hit.add(crab);
          const dx = crab.position.x - peggy.position.x, dz = crab.position.z - peggy.position.z;
          const d = Math.hypot(dx, dz) || 1;
          if (crab.hit(dx / d, dz / d, meleeSwing.power)) follow.addTrauma(0.16);
          if (crab.justDied) {
            crab.justDied = false;
            follow.addTrauma(0.2);
            for (let ci = 0; ci < 3; ci++) {
              const a = (ci / 3) * Math.PI * 2;
              addCoin(
                crab.position.x + Math.cos(a) * 0.9,
                crab.position.y + 0.7,
                crab.position.z + Math.sin(a) * 0.9
              );
            }
          }
        }
      }
    } else if (peggy.meleeTimer <= 0) {
      meleeSwing = null;
    }

    // ── doubloons ──────────────────────────────────────────────────────────
    for (const c of coins) {
      if (c.userData.collected) continue;
      const dx = c.position.x - peggy.position.x;
      const dy = c.position.y - (peggy.position.y + 0.8);
      const dz = c.position.z - peggy.position.z;
      if (dx * dx + dz * dz < 1.44 && Math.abs(dy) < 1.8) {
        c.userData.collected = true;
        c.visible = false;
        gold++;
        hud.gold.textContent = gold;
        hud.gold.classList.remove('pop');
        void hud.gold.offsetWidth;   // restart the pop animation
        hud.gold.classList.add('pop');
      }
    }

    // ── react to what happened ─────────────────────────────────────────────
    for (const e of peggy.drainEvents()) {
      if (e.type === 'melee') {
        follow.addTrauma(e.stage === 2 ? 0.22 : 0.10);
        // Open the strike window. Hits are NOT evaluated here — this event
        // fires on frame 0 of the swing, before the lunge has moved her, which
        // was exactly why crabs only died at point-blank. The per-frame check
        // below tests every frame of the swing, so the lunge carries the arc
        // into things the wind-up couldn't reach.
        meleeSwing = { hit: new Set(), power: e.power || 11 };
      } else if (e.type === 'jump' && e.air) {
        // Double jump: a small kick so the second jump reads as its own beat.
        model.impact(2.2);
        follow.addTrauma(0.05);
      } else if (e.type === 'land') {
        model.impact(e.impact);
        if (e.impact > 9) follow.addTrauma(clamp01((e.impact - 9) / 22) * 0.4);
      } else if (e.type === 'splash') {
        follow.addTrauma(clamp01(e.speed / 26) * 0.25);
      }
    }
    for (const e of hook.drainEvents()) {
      if (e.type === 'reelStart' || e.type === 'swingRelease') follow.addTrauma(0.14);
    }

    model.update(dt, peggy, {
      time,
      hookActive: hook.active,
      hookCharge: title.active ? 0 : input.hookCharge,
      faceLocked: peggy.faceLock != null,
      shooting,
    });

    ambience.update(dt, time);
    cannon.update(dt, { level, water, crabs, loose });
    if (title.vignette) title.vignette.update(dt, time);
    water.update(dt, camera);
    sky.update(camera);
    // Shadow camera rides along, so shadows stay sharp instead of being spread
    // across the whole island.
    lights.key.target.position.copy(peggy.position);
    lights.key.position.copy(peggy.position).addScaledVector(SUN_DIR, 90);

    // ── rope + hook head ───────────────────────────────────────────────────
    if (hook.active) {
      hook.handPosition(_v);
      _v2.copy(hook.head);
      const len = _v.distanceTo(_v2);
      rope.visible = len > 0.2;
      hookHead.visible = true;
      rope.position.copy(_v).lerp(_v2, 0.5);
      rope.scale.set(1, Math.max(len, 0.01), 1);
      rope.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        _v2.clone().sub(_v).normalize()
      );
      hookHead.position.copy(_v2);
      hookHead.lookAt(_v);
    } else {
      rope.visible = false;
      hookHead.visible = false;
    }

    // ── melee swipe arcs, one look per combo stage ─────────────────────────
    if (peggy.meleeTimer > 0) {
      const t = clamp01(1 - peggy.meleeTimer / (peggy.meleeDuration || 0.32));
      const stage = peggy.meleeStage || 0;
      if (stage === 2) {
        // the spin: a full expanding ring around her
        swipePivot.visible = false;
        spinRing.visible = true;
        spinRing.position.set(
          peggy.position.x,
          peggy.position.y + peggy.T.height * 0.5,
          peggy.position.z
        );
        spinRing.rotation.z = t * 6.0;
        spinRing.scale.setScalar(0.45 + t * 0.75);
        spinMat.opacity = Math.sin(t * Math.PI) * 0.95;
      } else {
        spinRing.visible = false;
        swipePivot.visible = true;
        swipePivot.position.set(
          peggy.position.x,
          peggy.position.y + peggy.T.height * 0.55,
          peggy.position.z
        );
        // forehand sweeps one way, backhand the other
        const dir = stage === 1 ? -1 : 1;
        swipePivot.rotation.y = peggy.facing + (-1.15 + t * 2.3) * dir;
        swipePivot.scale.setScalar(0.62 + t * 0.5);
        swipeMat.opacity = Math.sin(t * Math.PI) * 0.9;
      }
    } else {
      swipePivot.visible = false;
      spinRing.visible = false;
    }

    // ── underwater grade ───────────────────────────────────────────────────
    // Ease it, so surfacing is a rise out of the colour rather than a cut.
    fogT = damp(fogT, follow.underwater ? 1 : 0, 0.10, dt);
    scene.fog.color.copy(FOG_AIR).lerp(FOG_WATER, fogT);
    scene.fog.density = lerp(0.0032, 0.048, fogT);
    renderer.toneMappingExposure = lerp(1.05, 0.78, fogT);

    // spin the anchor rings so they read as interactive, and swell whichever
    // one the hook is currently locked onto
    for (const c of props.children) {
      if (!c.userData.spin) continue;
      c.rotation.z += c.userData.spin * (c.userData.targeted ? 2.6 : 1) * dt;
      const want = c.userData.targeted ? 1.75 : 1;
      c.scale.setScalar(damp(c.scale.x, want, 0.09, dt));
    }

    // ── hud ────────────────────────────────────────────────────────────────
    hudTick += dt;
    if (hudTick > 0.12) {
      hudTick = 0;
      hud.state.textContent = peggy.state.toUpperCase();
      hud.speed.textContent = Math.hypot(peggy.velocity.x, peggy.velocity.z).toFixed(1) + ' m/s';
      hud.fps.textContent = Math.round(fps) + ' fps';

      // Contextual hint — what the hook would do if you fired right now.
      let hint = '';
      if (input.hookAim.active && !hook.active) hint = 'AIMING · STEER WITH THE STICK · RELEASE TO THROW';
      else if (hook.state === HookState.SWINGING) hint = 'PUSH FORWARD TO CLIMB · TAP TO RELEASE';
      else if (hook.state === HookState.REELING) hint = 'REELING IN';
      else if (peggy.state === State.DIVE) hint = 'HOLD JUMP TO RISE · HOLD DIVE TO SINK';
      else if (peggy.state === State.SWIM) hint = 'TAP DIVE TO GO UNDER';
      hud.hint.textContent = hint;

      const aim = hook.aimDirection(_v);
      const target = level.findGrapplePoint(hook.handPosition(_v2), aim, 17, 0.28);

      // Light up the anchor she'd actually hook. Without this there is no way
      // to tell a throw that had no target from a throw that didn't fire —
      // both look like nothing happening.
      if (target !== hookTarget) {
        if (hookTarget && hookTarget.ring) hookTarget.ring.userData.targeted = false;
        if (target && target.ring) target.ring.userData.targeted = true;
        hookTarget = target;
      }

      // Live gesture readout, so a mis-detected gesture can be reported
      // precisely instead of described.
      const g = input.stickR.lastGesture;
      if (g) hud.gesture.textContent = g.toUpperCase();
      hud.gesture.classList.toggle('lit', !!g);

      // The prompt rides the right stick — wherever the thumb last left it.
      hud.prompt.classList.toggle('hidden', !promptTarget);
      if (promptTarget) {
        if (promptTarget.icon !== promptIconKey) {
          promptIconKey = promptTarget.icon;
          hud.promptIcon.setAttribute('href', '#i-' + promptIconKey);
          hud.promptLabel.textContent = promptTarget.label;
        }
        const sR = input.stickR;
        hud.prompt.style.left = (input.isTouch ? sR.centreX : innerWidth / 2) + 'px';
        hud.prompt.style.top = (input.isTouch ? sR.centreY : innerHeight * 0.74) + 'px';
      }
    }
  }

  function render(alpha, frameTime) {
    fps = lerp(fps, 1 / Math.max(frameTime, 1e-4), 0.08);
    // While the title holds the screen, the vignette is the only thing drawn —
    // the world simulates but pays no render cost, depth prepass included.
    if (title.active && title.vignette) {
      // The ortho vignette sits ~50m out, so lines barely fade there.
      if (ink) ink.render(title.vignette.scene, title.vignette.camera, { fade: 600 });
      else renderer.render(title.vignette.scene, title.vignette.camera);
      return;
    }
    // Depth prepass without the water, for the shoreline foam.
    water.renderDepth(renderer, scene, camera);
    if (ink) ink.render(scene, camera);
    else renderer.render(scene, camera);
  }

  const loop = new Loop({ update, render });
  loop.start();

  // ── resize ───────────────────────────────────────────────────────────────
  let resizeTimer = 0;
  function onResize() {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(devicePixelRatio, QUALITY.pixelRatio));
    renderer.setSize(innerWidth, innerHeight);
    water.resize();
    if (ink) ink.setSize();
    if (title.vignette) title.vignette.resize(innerWidth / innerHeight);
  }
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(onResize, 80);
  });
  addEventListener('orientationchange', () => setTimeout(onResize, 220));

  // Pause when backgrounded: a phone that keeps rendering in a hidden tab just
  // burns battery, and the loop's dt clamp handles the resume.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) loop.stop(); else loop.start();
  });

  // ── dev handles ──────────────────────────────────────────────────────────
  // Tuning a controller means changing a number and feeling it immediately.
  // Everything worth touching is reachable from the console.
  Object.assign(window, { THREE, scene, camera, renderer, peggy, hook, follow, level, water, input, model, loop, stairTops, QUALITY, coins, crabs, cannon, ink, loose });

  // Automation (navigator.webdriver — Playwright, the test suite) skips the
  // title entirely and lands straight in the game, as does ?notitle, so every
  // existing test keeps meaning what it meant.
  if (!navigator.webdriver && !/notitle/.test(location.search)) startTitle();
  else { title.el.remove(); document.getElementById('title-logo').remove(); }

  document.getElementById('boot').classList.add('gone');
  setTimeout(() => {
    document.getElementById('boot').remove();
    // The title's logo waits for the boot screen (which carries the same
    // logo, centred) to be fully gone — otherwise "Peggy" shows twice,
    // stacked, for the whole crossfade.
    const logo = document.getElementById('title-logo');
    if (logo) logo.classList.add('on');
  }, 600);
}

boot().catch((err) => {
  console.error(err);
  const b = document.getElementById('boot');
  if (b) b.innerHTML = `<div class="boot-error"><h1>She didn't launch</h1><pre>${String(err && err.stack || err)}</pre></div>`;
});
