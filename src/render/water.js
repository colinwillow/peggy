// The sea.
//
// Half this game happens in or above water, so it has to do four jobs:
//   1. read as toon water from a distance (banded colour, no photoreal specular)
//   2. give a real, sample-able surface height so swimming can bob on the waves
//   3. show a foam line where it meets the land, which is what makes an island
//      read as an island rather than a shape intersecting a blue plane
//   4. still look correct from underneath, because you can dive
//
// Foam uses the depth buffer: compare the water surface's depth against what
// was already drawn behind it, and where the difference is small you're near a
// shoreline. That's one extra texture read and it gets both beaches and every
// rock, hull and post automatically, with no authoring.

import * as THREE from '../../vendor/three/three.module.js';

// Wave set shared by CPU and GPU. Keep these in sync with WAVES below —
// swimming bobs on the CPU result, so a mismatch means Peggy floats inside the
// crest instead of on it.
const WAVE_PARAMS = [
  { dirX: 1.00, dirZ: 0.25, len: 22.0, amp: 0.42, speed: 1.05 },
  { dirX: -0.42, dirZ: 0.88, len: 13.0, amp: 0.24, speed: 1.45 },
  { dirX: 0.65, dirZ: -0.72, len: 6.5, amp: 0.11, speed: 2.10 },
];

/** CPU-side surface height — must match the vertex shader below. */
export function waveHeight(x, z, time) {
  let y = 0;
  for (const w of WAVE_PARAMS) {
    const k = (Math.PI * 2) / w.len;
    const d = (w.dirX * x + w.dirZ * z);
    y += Math.sin(d * k + time * w.speed) * w.amp;
  }
  return y;
}

// Shared by both stages. The fragment shader re-evaluates the wave analytically
// per PIXEL rather than interpolating the vertex result, because the plane is
// hundreds of metres wide and the shortest wave is 6.5m — the grid samples it
// at barely two points per wavelength, and interpolated banding across that
// turns the sea into visible flat polygons. Recomputing costs three sines and
// is exact at any tessellation.
const WAVE_GLSL = /* glsl */`
  float waveAt( vec2 p, float t ) {
    float y = 0.0;
    y += sin( dot( p, vec2( 1.00,  0.25 ) ) * ( 6.2831853 / 22.0 ) + t * 1.05 ) * 0.42;
    y += sin( dot( p, vec2(-0.42,  0.88 ) ) * ( 6.2831853 / 13.0 ) + t * 1.45 ) * 0.24;
    y += sin( dot( p, vec2( 0.65, -0.72 ) ) * ( 6.2831853 /  6.5 ) + t * 2.10 ) * 0.11;
    return y;
  }
`;

const vert = /* glsl */`
  uniform float uTime;
  varying vec3 vWorld;
` + WAVE_GLSL + `
  void main() {
    vec4 wp = modelMatrix * vec4( position, 1.0 );
    wp.y += waveAt( wp.xz, uTime );
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const frag = /* glsl */`
  uniform vec3  uShallow;
  uniform vec3  uDeep;
  uniform vec3  uFoam;
  uniform float uTime;
  uniform sampler2D uDepth;
  uniform vec2  uResolution;
  uniform float uNear;
  uniform float uFar;
  uniform float uFoamWidth;
  uniform vec3  uSunDir;

  varying vec3  vWorld;
` + WAVE_GLSL + `
  float linearDepth( float z ) {
    float ndc = z * 2.0 - 1.0;
    return ( 2.0 * uNear * uFar ) / ( uFar + uNear - ndc * ( uFar - uNear ) );
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / uResolution;

    // Per-pixel wave height + an analytic gradient for the normal. Both exact,
    // both independent of how coarse the mesh is.
    float vWave = waveAt( vWorld.xz, uTime );
    float e = 0.35;
    float gx = waveAt( vWorld.xz + vec2( e, 0.0 ), uTime ) - waveAt( vWorld.xz - vec2( e, 0.0 ), uTime );
    float gz = waveAt( vWorld.xz + vec2( 0.0, e ), uTime ) - waveAt( vWorld.xz - vec2( 0.0, e ), uTime );

    // ── distance falloff ──────────────────────────────────────────────────
    // Every high-frequency term below has to die off toward the horizon. The
    // wave grid is a few metres across, so past a hundred metres or so it is
    // finer than a pixel, and banding evaluated there aliases into a crawling
    // checkerboard that reads as a texture bug. Fading to flat open-sea colour
    // is both cheaper and what the art direction wants anyway.
    float viewDist = length( cameraPosition - vWorld );
    float detail = 1.0 - smoothstep( 55.0, 240.0, viewDist );

    // ── colour: banded by wave height, so crests read lighter in solid steps
    float band = floor( ( vWave + 0.7 ) * 2.6 ) / 2.6;
    vec3 col = mix( uDeep, uShallow, clamp( band * 0.55 + 0.35, 0.0, 1.0 ) );
    col = mix( mix( uDeep, uShallow, 0.42 ), col, detail );

    // ── shoreline foam from the depth buffer
    float sceneZ = linearDepth( texture2D( uDepth, uv ).x );
    float waterZ = linearDepth( gl_FragCoord.z );
    float diff   = sceneZ - waterZ;

    float shore = 1.0 - clamp( diff / uFoamWidth, 0.0, 1.0 );
    // wobble the foam edge so it isn't a clean offset of the geometry
    float wob = sin( vWorld.x * 1.7 + uTime * 1.6 ) * 0.5
              + sin( vWorld.z * 2.3 - uTime * 1.1 ) * 0.5;
    shore = smoothstep( 0.35, 0.75, shore + wob * 0.14 );

    // a second, tighter band right at the contact line
    float lip = smoothstep( 0.80, 0.96, 1.0 - clamp( diff / ( uFoamWidth * 0.34 ), 0.0, 1.0 ) );

    col = mix( col, uFoam, max( shore * 0.62, lip ) * detail );

    // ── crest highlight: pure toon, a hard cut at the top of the tallest waves
    col = mix( col, uFoam, smoothstep( 0.58, 0.68, vWave ) * 0.26 * detail );

    // ── sun glint, quantised so it flickers as chunks rather than sparkling
    vec3 V = normalize( cameraPosition - vWorld );
    vec3 N = normalize( vec3( -gx / ( 2.0 * e ), 1.0, -gz / ( 2.0 * e ) ) );
    float spec = max( dot( reflect( -normalize( uSunDir ), N ), V ), 0.0 );
    col += vec3( 1.0, 0.97, 0.85 ) * step( 0.86, pow( spec, 12.0 ) ) * 0.5 * detail;

    gl_FragColor = vec4( col, 0.90 );
    #include <colorspace_fragment>
  }
`;

export class Water {
  /**
   * @param {number} level  world Y of the still surface. Everything else in the
   *   game treats this as sea level, so it is the origin of the vertical axis.
   */
  constructor(scene, renderer, opts = {}) {
    const {
      level = 0,
      // The plane follows the camera, so it only has to reach the far plane —
      // and a smaller plane at the same segment count is a much finer grid,
      // which is what keeps the vertex displacement from going faceted.
      size = 1400,
      segments = 340,
      shallow = 0x53d7c8,
      deep = 0x0f5a86,
      foam = 0xf2fbff,
      foamWidth = 2.6,
      sunDir = new THREE.Vector3(38, 60, 26).normalize(),
      depthScale = 0.5,
    } = opts;

    this.level = level;
    this.time = 0;

    // Depth target for the shoreline foam. Half-res is plenty — foam is a soft
    // wide band, and this keeps the extra pass cheap on a phone.
    this._depthScale = depthScale;
    this.depthTarget = new THREE.WebGLRenderTarget(1, 1);
    this.depthTarget.texture.minFilter = THREE.NearestFilter;
    this.depthTarget.texture.magFilter = THREE.NearestFilter;
    this.depthTarget.depthTexture = new THREE.DepthTexture();
    this.depthTarget.depthTexture.type = THREE.UnsignedShortType;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uShallow: { value: new THREE.Color(shallow) },
        uDeep: { value: new THREE.Color(deep) },
        uFoam: { value: new THREE.Color(foam) },
        uDepth: { value: this.depthTarget.depthTexture },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uNear: { value: 0.1 },
        uFar: { value: 3000 },
        uFoamWidth: { value: foamWidth },
        uSunDir: { value: sunDir.clone() },
      },
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      side: THREE.DoubleSide, // you can look at it from underneath
      depthWrite: false,
    });

    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.position.y = level;
    this.mesh.renderOrder = 10;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'water';
    scene.add(this.mesh);

    this._scene = scene;
    this._renderer = renderer;
    this.resize();
  }

  resize() {
    const buf = this._renderer.getDrawingBufferSize(new THREE.Vector2());
    // The depth target is downscaled to keep the extra pass cheap...
    this.depthTarget.setSize(Math.max(1, Math.floor(buf.x * this._depthScale)), Math.max(1, Math.floor(buf.y * this._depthScale)));
    // ...but uResolution must be the MAIN framebuffer size, because the shader
    // derives its lookup from gl_FragCoord, which is in main-framebuffer pixels.
    // Dividing those by the half-res size gives uv up to 2.0, the sampler clamps
    // to the texture edge, and the foam term reads one stretched row of depth —
    // which paints big smooth white slabs across open water that look nothing
    // like a shoreline. The depth texture's own size never enters into it; uv is
    // normalised.
    this.material.uniforms.uResolution.value.copy(buf);
  }

  /** Surface height at a world position, waves included. */
  heightAt(x, z) {
    return this.level + waveHeight(x, z, this.time);
  }

  update(dt, camera) {
    this.time += dt;
    this.material.uniforms.uTime.value = this.time;
    this.material.uniforms.uNear.value = camera.near;
    this.material.uniforms.uFar.value = camera.far;
    // Follow the camera so the plane never runs out from under you, snapped to
    // whole wavelengths so the waves don't visibly slide as you swim.
    this.mesh.position.x = Math.round(camera.position.x / 22) * 22;
    this.mesh.position.z = Math.round(camera.position.z / 22) * 22;
  }

  /**
   * Render the scene's depth without the water in it. Must run before the main
   * pass each frame.
   */
  renderDepth(renderer, scene, camera) {
    this.mesh.visible = false;
    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(this.depthTarget);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(prevTarget);
    this.mesh.visible = true;
  }
}
