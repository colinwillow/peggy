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
import { Peggy, State } from './player/Peggy.js';
import { Hook, HookState } from './player/Hook.js';
import { createPeggyModel } from './player/PeggyModel.js';
import { FollowCamera } from './camera/FollowCamera.js';

const SUN_DIR = new THREE.Vector3(38, 60, 26).normalize();

// Fog colours for above and below the surface. Swapping these on the camera's
// underwater flag is what makes diving feel like a different place rather than
// the same scene with a blue plane over the lens.
const FOG_AIR = new THREE.Color(0xbfe9ff);
const FOG_WATER = new THREE.Color(0x1a6f8f);

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
  scene.fog = new THREE.FogExp2(FOG_AIR.getHex(), 0.0032);

  const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 3000);
  camera.position.set(0, 10, 20);

  // ── world ────────────────────────────────────────────────────────────────
  const lights = setupLights(scene, {
    shadowExtent: QUALITY.shadowExtent,
    shadowMapSize: QUALITY.shadowMapSize,
  });
  lights.key.position.copy(SUN_DIR).multiplyScalar(90);

  const sky = new Sky(scene, { sunDir: SUN_DIR });
  const water = new Water(scene, renderer, {
    level: 0, sunDir: SUN_DIR,
    size: QUALITY.waterSize,
    segments: QUALITY.waterSegments,
    depthScale: QUALITY.waterDepthScale,
  });

  const { level, props, spawn, stairTops } = buildTestIsland(scene);

  const terrainMat = toonMaterial({
    color: 0xffffff,
    rimColor: 0xfff0c8,
    rimStrength: 0.28,
    rimPower: 3.0,
  });
  terrainMat.vertexColors = true;
  const terrain = level.buildTerrainMesh(terrainMat, {
    size: QUALITY.terrainSize,
    segments: QUALITY.terrainSegments,
  });
  scene.add(terrain);

  // ── player ───────────────────────────────────────────────────────────────
  const peggy = new Peggy(level, water);
  peggy.teleport(spawn.x, spawn.y, spawn.z);

  const model = await createPeggyModel();
  scene.add(model.object3D);

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

  const hookHead = new THREE.Mesh(
    new THREE.TorusGeometry(0.16, 0.045, 6, 12, Math.PI * 1.4),
    toonMaterial({ color: 0x9aa3ad, rimStrength: 0.9, rimColor: 0xffffff })
  );
  hookHead.visible = false;
  hookHead.castShadow = true;
  scene.add(hookHead);

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

  const hud = {
    state: document.getElementById('hud-state'),
    speed: document.getElementById('hud-speed'),
    fps: document.getElementById('hud-fps'),
    hint: document.getElementById('hud-hint'),
    reticle: document.getElementById('reticle'),
  };
  document.body.classList.toggle('touch', input.isTouch);

  // ── frame state ──────────────────────────────────────────────────────────
  const _v = new THREE.Vector3();
  const _v2 = new THREE.Vector3();
  let fogT = 0;
  let fps = 60;
  let hudTick = 0;

  function update(dt, time) {
    input.sample(dt);

    peggy.update(dt, input.move, input, follow.yaw);
    if (input.recentre.pressed) follow.recentre(peggy);
    hook.update(dt, input, input.move);
    follow.update(dt, peggy, input.look);

    // ── react to what happened ─────────────────────────────────────────────
    for (const e of peggy.drainEvents()) {
      if (e.type === 'land') {
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
    });

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

    // ── underwater grade ───────────────────────────────────────────────────
    // Ease it, so surfacing is a rise out of the colour rather than a cut.
    fogT = damp(fogT, follow.underwater ? 1 : 0, 0.10, dt);
    scene.fog.color.copy(FOG_AIR).lerp(FOG_WATER, fogT);
    scene.fog.density = lerp(0.0032, 0.048, fogT);
    renderer.toneMappingExposure = lerp(1.05, 0.78, fogT);

    // spin the anchor rings so they read as interactive
    for (const c of props.children) {
      if (c.userData.spin) c.rotation.z += c.userData.spin * dt;
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
      if (hook.state === HookState.SWINGING) hint = 'PUSH FORWARD TO CLIMB · TAP TO RELEASE';
      else if (hook.state === HookState.REELING) hint = 'REELING IN';
      else if (peggy.state === State.DIVE) hint = 'HOLD JUMP TO RISE · HOLD DIVE TO SINK';
      else if (peggy.state === State.SWIM) hint = 'TAP DIVE TO GO UNDER';
      hud.hint.textContent = hint;

      // Reticle lights up when something is in hook range.
      const aim = hook.aimDirection(_v);
      const target = level.findGrapplePoint(hook.handPosition(_v2), aim, 17, 0.35);
      hud.reticle.classList.toggle('locked', !!target);
    }
  }

  function render(alpha, frameTime) {
    fps = lerp(fps, 1 / Math.max(frameTime, 1e-4), 0.08);
    // Depth prepass without the water, for the shoreline foam.
    water.renderDepth(renderer, scene, camera);
    renderer.render(scene, camera);
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
  Object.assign(window, { THREE, scene, camera, renderer, peggy, hook, follow, level, water, input, model, loop, stairTops, QUALITY });

  document.getElementById('boot').classList.add('gone');
  setTimeout(() => document.getElementById('boot').remove(), 600);
}

boot().catch((err) => {
  console.error(err);
  const b = document.getElementById('boot');
  if (b) b.innerHTML = `<div class="boot-error"><h1>She didn't launch</h1><pre>${String(err && err.stack || err)}</pre></div>`;
});
