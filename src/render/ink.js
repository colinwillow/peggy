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

    vec3 outCol = mix( col.rgb, uInk, edge * 0.9 );
    // The sRGB target is HARDWARE-DECODED when sampled, so outCol is linear
    // here — and the screen wants sRGB. Without this encode the whole game
    // went dark and oversaturated the moment it rendered offscreen.
    vec3 lo = outCol * 12.92;
    vec3 hi = 1.055 * pow( outCol, vec3( 1.0 / 2.4 ) ) - 0.055;
    outCol = mix( lo, hi, step( 0.0031308, outCol ) );
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

    this.renderer.setRenderTarget(this.target);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this._quadScene, this._quadCam);
  }
}
