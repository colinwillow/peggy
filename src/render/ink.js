// The ink pass: screen-space outlines.
//
// The inverted-hull shell draws a line by inflating GEOMETRY, which makes the
// line's quality hostage to the mesh — seams tear it, dense noise scribbles
// it, and its width changes with distance. This pass draws the line the way a
// hand does: look at the picture, find the edges, ink them.
//
// Mechanics: the scene renders into a target that keeps its DEPTH. A
// fullscreen pass then compares each pixel's view-space depth against its
// neighbours a line-width away; where a neighbour is significantly FARTHER,
// this pixel is the near side of a silhouette, and it gets ink. Lines land on
// the near object (the thing you'd outline), are the same width at every
// distance, and exist for every object on screen with zero per-mesh work.
//
// The threshold is RELATIVE to depth (neighbour 12% farther), not absolute:
// an absolute threshold either misses nearby edges or draws all over distant
// terrain, because perspective compresses far depth ranges.

import * as THREE from '../../vendor/three/three.module.js';

const VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4( position.xy, 0.0, 1.0 );
  }
`;

const FRAG = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform vec2 uTexel;
  uniform float uNear, uFar;
  uniform float uOrtho;      // 1.0 for orthographic cameras
  uniform float uThickness;  // in device pixels
  uniform float uEdge;       // relative depth step that counts as an edge
  uniform float uFade;       // metres at which lines have fully faded
  uniform vec3 uInk;
  uniform float uTint;       // 0 = flat off-black ink, 1 = the surface's own colour, pulled dark
  // ── the finish (lifted from iq's Volcanic, restrained for cel) ──────────
  // Aerial perspective — per-channel haze that thickens with distance and
  // warms toward the sun — plus a film grade: S-curve contrast, a breath of
  // desaturation, a per-world tint, a vignette.
  uniform vec3 uCamRight, uCamUp, uCamFwd;
  uniform vec2 uProjK;       // tan(fov/2) * aspect, tan(fov/2)
  uniform vec3 uSunW;        // sun direction, world space
  uniform vec3 uHazeCol;     // what distance dissolves into
  uniform vec3 uHazeSun;     // ...and what it dissolves into sunward
  uniform float uHazeK;      // extinction per metre (small!)
  uniform vec3 uGradeTint;
  uniform float uDesat;
  uniform float uContrast;
  uniform float uVignette;

  float viewZ( vec2 uv ) {
    float d = texture2D( tDepth, uv ).x;
    if ( uOrtho > 0.5 ) return uNear + ( uFar - uNear ) * d;
    float z = d * 2.0 - 1.0;
    return ( 2.0 * uNear * uFar ) / ( uFar + uNear - z * ( uFar - uNear ) );
  }

  void main() {
    vec4 col = texture2D( tColor, vUv );
    float c = viewZ( vUv );
    vec2 o = uTexel * uThickness;
    float mx = c;
    mx = max( mx, viewZ( vUv + vec2(  o.x, 0.0 ) ) );
    mx = max( mx, viewZ( vUv + vec2( -o.x, 0.0 ) ) );
    mx = max( mx, viewZ( vUv + vec2( 0.0,  o.y ) ) );
    mx = max( mx, viewZ( vUv + vec2( 0.0, -o.y ) ) );
    mx = max( mx, viewZ( vUv + vec2(  o.x,  o.y ) ) );
    mx = max( mx, viewZ( vUv + vec2( -o.x, -o.y ) ) );
    mx = max( mx, viewZ( vUv + vec2(  o.x, -o.y ) ) );
    mx = max( mx, viewZ( vUv + vec2( -o.x,  o.y ) ) );

    float rel = ( mx - c ) / max( c, 0.001 );
    float edge = smoothstep( uEdge, uEdge * 1.6, rel );
    edge *= clamp( 1.0 - c / uFade, 0.0, 1.0 );

    // Coloured line art: the ink is the near surface's own colour squared —
    // darker AND more saturated, like lining with the fill's own pencil —
    // rather than one global black. uTint dials between that and the flat
    // off-black plum. (col is linear here; squaring in linear space is what
    // gives the saturation push.)
    vec3 localInk = col.rgb * col.rgb * 0.42 + col.rgb * 0.05;
    vec3 inkCol = mix( uInk, localInk, uTint );
    vec3 outCol = mix( col.rgb, inkCol, edge * 0.9 );

    // ── aerial perspective, in post, from the depth we already have ────────
    // Per-CHANNEL extinction (blue dies fastest), so distance goes warm-hazy
    // instead of uniformly grey, and the haze itself warms toward the sun.
    // The sky writes no depth (c = far), so a far-mask excludes it — the
    // dome paints its own atmosphere.
    if ( uHazeK > 0.0 && uOrtho < 0.5 ) {
      vec2 ndc = vUv * 2.0 - 1.0;
      vec3 vdir = normalize( uCamFwd + uCamRight * ndc.x * uProjK.x + uCamUp * ndc.y * uProjK.y );
      float sunAmt = pow( clamp( dot( vdir, uSunW ), 0.0, 1.0 ), 6.0 );
      vec3 ext = exp( -min( c, 500.0 ) * uHazeK * vec3( 0.70, 1.0, 1.45 ) );
      float skyMask = 1.0 - smoothstep( 500.0, 900.0, c );
      vec3 hazeCol = mix( uHazeCol, uHazeSun, sunAmt );
      outCol = mix( outCol, outCol * ext + hazeCol * ( 1.0 - ext ), skyMask );
    }
    // The sRGB target is HARDWARE-DECODED when sampled, so outCol is linear
    // here — and the screen wants sRGB. Without this encode the whole game
    // went dark and oversaturated the moment it rendered offscreen.
    vec3 lo = outCol * 12.92;
    vec3 hi = 1.055 * pow( outCol, vec3( 1.0 / 2.4 ) ) - 0.055;
    outCol = mix( lo, hi, step( 0.0031308, outCol ) );

    // ── the grade — display-referred, like grading on the print ───────────
    // (No gain or gamma from the original: the renderer already tonemaps,
    // and stacking tonemaps is how cel colours turn to crunch.)
    outCol = mix( outCol, outCol * outCol * ( 3.0 - 2.0 * outCol ), uContrast );
    float luma = dot( outCol, vec3( 0.299, 0.587, 0.114 ) );
    outCol = mix( outCol, vec3( luma ), uDesat );
    outCol *= uGradeTint;
    float vig = pow( 16.0 * vUv.x * vUv.y * ( 1.0 - vUv.x ) * ( 1.0 - vUv.y ), 0.18 );
    outCol *= 1.0 - uVignette * ( 1.0 - vig );

    gl_FragColor = vec4( outCol, 1.0 );
  }
`;

export class InkPass {
  constructor(renderer, opts = {}) {
    this.renderer = renderer;

    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.target = new THREE.WebGLRenderTarget(size.x, size.y, {
      depthTexture: new THREE.DepthTexture(size.x, size.y),
      // The scene's materials encode to the target's colour space, so the
      // composite can copy texels straight to the screen with no conversion.
      colorSpace: THREE.SRGBColorSpace,
      // MSAA on the target, or the whole game loses its antialiasing the
      // moment it renders offscreen.
      samples: opts.samples ?? 4,
    });

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: this.target.texture },
        tDepth: { value: this.target.depthTexture },
        uTexel: { value: new THREE.Vector2(1 / size.x, 1 / size.y) },
        uNear: { value: 0.1 },
        uFar: { value: 3000 },
        uOrtho: { value: 0 },
        uThickness: { value: (opts.thickness ?? 1.9) * renderer.getPixelRatio() },
        uEdge: { value: opts.edge ?? 0.018 },
        uFade: { value: 90 },
        uInk: { value: new THREE.Color(opts.ink ?? 0x1c1424) },
        uTint: { value: opts.tint ?? 0.8 },
        uCamRight: { value: new THREE.Vector3(1, 0, 0) },
        uCamUp: { value: new THREE.Vector3(0, 1, 0) },
        uCamFwd: { value: new THREE.Vector3(0, 0, -1) },
        uProjK: { value: new THREE.Vector2(1, 1) },
        uSunW: { value: new THREE.Vector3(0, 1, 0) },
        uHazeCol: { value: new THREE.Color(0x000000) },
        uHazeSun: { value: new THREE.Color(0x000000) },
        uHazeK: { value: 0 },
        uGradeTint: { value: new THREE.Color(0xffffff) },
        uDesat: { value: 0 },
        uContrast: { value: 0 },
        uVignette: { value: 0 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
    });

    this._quadScene = new THREE.Scene();
    this._quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this._quadScene.add(quad);
  }

  /** Per-world finish: haze colours/strength, tint, contrast, desat, vignette. */
  setLook(opts = {}) {
    const u = this.material.uniforms;
    if (opts.hazeColor != null) u.uHazeCol.value.set(opts.hazeColor);
    if (opts.hazeSun != null) u.uHazeSun.value.set(opts.hazeSun);
    if (opts.hazeK != null) u.uHazeK.value = opts.hazeK;
    if (opts.sunDir) u.uSunW.value.copy(opts.sunDir).normalize();
    if (opts.gradeTint != null) u.uGradeTint.value.set(opts.gradeTint);
    if (opts.desat != null) u.uDesat.value = opts.desat;
    if (opts.contrast != null) u.uContrast.value = opts.contrast;
    if (opts.vignette != null) u.uVignette.value = opts.vignette;
  }

  setSize() {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.target.setSize(size.x, size.y);
    this.material.uniforms.uTexel.value.set(1 / size.x, 1 / size.y);
    this.material.uniforms.uThickness.value = 1.9 * this.renderer.getPixelRatio();
  }

  /**
   * Render `scene` through `camera` with the ink composite on top.
   * @param opts { fade } — line fade distance in metres (far scenes differ)
   */
  render(scene, camera, opts = {}) {
    const u = this.material.uniforms;
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    u.uOrtho.value = camera.isOrthographicCamera ? 1 : 0;
    u.uFade.value = opts.fade ?? 90;

    // camera basis + frustum scale, for reconstructing view rays in the haze
    const els = camera.matrixWorld.elements;
    u.uCamRight.value.set(els[0], els[1], els[2]);
    u.uCamUp.value.set(els[4], els[5], els[6]);
    u.uCamFwd.value.set(-els[8], -els[9], -els[10]);
    if (camera.isPerspectiveCamera) {
      const t = Math.tan((camera.fov * Math.PI) / 360);
      u.uProjK.value.set(t * camera.aspect, t);
    }

    this.renderer.setRenderTarget(this.target);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this._quadScene, this._quadCam);
  }
}
