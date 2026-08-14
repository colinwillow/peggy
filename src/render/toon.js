// The toon look.
//
// Target: Wind Waker — flat vibrant fills, hard-edged light, a warm rim so the
// silhouette pops off the sky, and a black ink outline. Deliberately NOT a
// photoreal pipeline with the saturation cranked; the whole point is that
// shading reads as two or three solid tones, not a gradient.
//
// Built on MeshToonMaterial rather than a from-scratch ShaderMaterial, because
// that inherits three's shadows, fog and lighting for free and stays compatible
// with whatever the GLB exporter emits. The banding comes from a gradient map;
// the rim light is patched in via onBeforeCompile.

import * as THREE from '../../vendor/three/three.module.js';

/**
 * A 1D gradient map is what turns smooth N·L into hard bands. `stops` are the
 * band boundaries — three entries gives three tones, which is the sweet spot:
 * two reads flat, four starts looking like a gradient again.
 */
export function makeGradientMap(stops = [0.35, 0.62, 1.0], shades = [0.55, 0.82, 1.0]) {
  const n = 64;
  const data = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    let v = shades[shades.length - 1];
    for (let s = 0; s < stops.length; s++) {
      if (t <= stops[s]) { v = shades[s]; break; }
    }
    const b = Math.round(v * 255);
    data[i * 4 + 0] = b; data[i * 4 + 1] = b; data[i * 4 + 2] = b; data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, n, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

let _gradient = null;
export function defaultGradient() {
  if (!_gradient) _gradient = makeGradientMap();
  return _gradient;
}

/**
 * Rim light, injected into the toon shader.
 *
 * This is what sells the look on a phone: a warm band around the edge of every
 * object facing away from the camera, so characters separate from the water and
 * the sky without needing an expensive post pass. Also banded — a smooth rim
 * would fight the flat fills everywhere else.
 */
function patchRim(material, { rimColor, rimPower, rimStrength }) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = { value: new THREE.Color(rimColor) };
    shader.uniforms.uRimPower = { value: rimPower };
    shader.uniforms.uRimStrength = { value: rimStrength };

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform vec3 uRimColor;
         uniform float uRimPower;
         uniform float uRimStrength;`
      )
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
         {
           vec3 V = normalize( vViewPosition );
           float f = 1.0 - clamp( dot( normalize( normal ), V ), 0.0, 1.0 );
           f = pow( f, uRimPower );
           // band it, so the rim matches the flat fills instead of smearing
           f = smoothstep( 0.45, 0.62, f );
           gl_FragColor.rgb += uRimColor * f * uRimStrength;
         }`
      );
    material.userData.shader = shader;
  };
  // Force a distinct program so materials with different rim settings don't
  // collide in three's shader cache.
  material.customProgramCacheKey = () =>
    `rim:${rimColor}:${rimPower}:${rimStrength}`;
}

/**
 * The standard character/prop material.
 */
export function toonMaterial(opts = {}) {
  const {
    color = 0xffffff,
    map = null,
    gradientMap = defaultGradient(),
    rimColor = 0xffd9a0,
    rimPower = 2.2,
    rimStrength = 0.5,
    transparent = false,
    opacity = 1,
    side = THREE.FrontSide,
  } = opts;

  const mat = new THREE.MeshToonMaterial({
    color, map, gradientMap, transparent, opacity, side,
  });
  patchRim(mat, { rimColor, rimPower, rimStrength });
  return mat;
}

// ── OUTLINES ───────────────────────────────────────────────────────────────
// Inverted-hull: draw the mesh again, expanded along its normals, with front
// faces culled. Cheap, works on every phone GPU, and gives the hand-inked edge
// that cel shading needs. The alternative — a screen-space edge-detect post
// pass — costs a full-screen pass and misses interior lines.
//
// The expansion is scaled by view distance so distant objects don't end up
// wearing a fat black halo, and clamped so nearby ones don't lose the line.

const outlineVert = /* glsl */`
  uniform float uThickness;
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
    vec3 n = normalize( normalMatrix * normal );
    // Scale WITH view depth, so the line holds a roughly constant pixel width:
    // an outline of fixed world thickness shrinks to nothing in the distance.
    // Normalised at 6m (about the follow-cam's boom length) so uThickness reads
    // directly as "world units at normal play distance".
    float depthScale = clamp( -mvPosition.z / 6.0, 0.45, 4.0 );
    mvPosition.xyz += n * uThickness * depthScale;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const outlineFrag = /* glsl */`
  uniform vec3 uColor;
  uniform float uOpacity;
  void main() { gl_FragColor = vec4( uColor, uOpacity ); }
`;

export function outlineMaterial({ color = 0x140a1e, thickness = 0.03, opacity = 1 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uThickness: { value: thickness },
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
    },
    vertexShader: outlineVert,
    fragmentShader: outlineFrag,
    side: THREE.BackSide,
    transparent: opacity < 1,
    depthWrite: true,
  });
}

/**
 * Give an object an ink outline. Returns the outline object so it can be
 * removed later. Skinned meshes get a SkinnedMesh outline sharing the same
 * skeleton, so the line deforms with the animation instead of floating.
 */
export function addOutline(target, opts = {}) {
  const { minSize = 0.06, ...matOpts } = opts;
  const mat = outlineMaterial(matOpts);

  // Collect first, then attach. Adding children mid-traverse would have the
  // traversal walk into the outlines it just created.
  const sources = [];
  target.traverse((o) => {
    if (!o.isMesh && !o.isSkinnedMesh) return;
    if (o.userData.noOutline || o.userData.isOutline) return;
    // Skip tiny details. An ink line around a pupil or a sucker reads as dirt
    // at any sane screen size, and each one is another draw call.
    if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
    if (o.geometry.boundingSphere.radius < minSize) return;
    sources.push(o);
  });

  const created = [];
  for (const o of sources) {
    let clone;
    if (o.isSkinnedMesh) {
      clone = new THREE.SkinnedMesh(o.geometry, mat);
      clone.bind(o.skeleton, o.bindMatrix);
    } else {
      clone = new THREE.Mesh(o.geometry, mat);
    }
    // Parent the outline TO the mesh it outlines, with an identity local
    // transform, so it inherits the world matrix for free — including every
    // animated bone and every squash-and-stretch scale.
    //
    // The alternative (a flat sibling group that copies matrixWorld in an
    // onBeforeRender hook) silently does nothing: Group is never a render item,
    // so the renderer never calls its onBeforeRender, and the outlines stay
    // parked at the origin where you cannot see them.
    clone.userData.isOutline = true;
    clone.castShadow = false;
    clone.receiveShadow = false;
    o.add(clone);
    created.push(clone);
  }
  return created;
}

/**
 * Scene lighting for the toon look: one strong warm key that casts the shadows,
 * a cool sky/ground hemisphere for bounce, and a dim fill from behind so the
 * unlit side never goes to mud. Three lights, no more — banded shading falls
 * apart the moment several keys overlap and produce half-bands.
 */
export function setupLights(scene, opts = {}) {
  const {
    keyColor = 0xfff3d8,
    keyIntensity = 1.62,
    skyColor = 0x9fd8ff,
    groundColor = 0x4a6b52,
    hemiIntensity = 0.80,
    fillColor = 0x86b8ff,
    fillIntensity = 0.32,
    shadowExtent = 34,
    shadowMapSize = 2048,
  } = opts;

  const key = new THREE.DirectionalLight(keyColor, keyIntensity);
  key.position.set(38, 60, 26);
  key.castShadow = true;
  key.shadow.mapSize.set(shadowMapSize, shadowMapSize);
  key.shadow.camera.near = 20;
  key.shadow.camera.far = 175;
  // Tight, and it follows the player. A wide shadow camera spreads the same
  // 2048 texels over the whole island and every shadow turns to mush; a tight
  // one keeps them crisp where you're actually looking.
  const s = shadowExtent;
  key.shadow.camera.left = -s;
  key.shadow.camera.right = s;
  key.shadow.camera.top = s;
  key.shadow.camera.bottom = -s;
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.035;
  scene.add(key);
  scene.add(key.target);

  const hemi = new THREE.HemisphereLight(skyColor, groundColor, hemiIntensity);
  scene.add(hemi);

  const fill = new THREE.DirectionalLight(fillColor, fillIntensity);
  fill.position.set(-30, 18, -34);
  scene.add(fill);

  return { key, hemi, fill };
}
