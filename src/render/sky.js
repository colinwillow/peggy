// Sky dome + sun.
//
// A shader dome rather than a cubemap: it's a few hundred bytes instead of six
// textures, the horizon colour can be driven from the same palette as the
// water and fog, and it recolours for time-of-day with two uniforms. Banded to
// match everything else — a smooth sky gradient behind flat-shaded islands
// looks like two different games stitched together.

import * as THREE from '../../vendor/three/three.module.js';

const vert = /* glsl */`
  varying vec3 vWorldDir;
  void main() {
    vec4 wp = modelMatrix * vec4( position, 1.0 );
    vWorldDir = normalize( wp.xyz - cameraPosition );
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }
`;

const frag = /* glsl */`
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform float uBands;
  varying vec3 vWorldDir;

  void main() {
    vec3 d = normalize( vWorldDir );
    float h = clamp( d.y * 0.5 + 0.5, 0.0, 1.0 );

    // quantise the vertical gradient into visible steps, then soften each
    // boundary just enough to avoid a hard staircase on a big phone screen
    float t = pow( h, 0.75 );
    float stepped = floor( t * uBands ) / uBands;
    float frac = fract( t * uBands );
    stepped += smoothstep( 0.82, 1.0, frac ) / uBands;

    vec3 col = mix( uHorizon, uTop, stepped );

    // sun: a hard disc with one soft bloom ring, no smooth falloff
    float sd = dot( d, normalize( uSunDir ) );
    col += uSunColor * smoothstep( 0.9975, 0.9990, sd );
    col += uSunColor * 0.30 * smoothstep( 0.960, 0.9975, sd );
    col += uSunColor * 0.10 * smoothstep( 0.870, 0.960, sd );

    gl_FragColor = vec4( col, 1.0 );
    #include <colorspace_fragment>
  }
`;

export class Sky {
  constructor(scene, opts = {}) {
    const {
      top = 0x2b7fd4,
      horizon = 0xbfe9ff,
      sunColor = 0xfff3c4,
      sunDir = new THREE.Vector3(38, 60, 26).normalize(),
      bands = 7,
      // Must sit comfortably INSIDE the camera's far plane. A dome larger than
      // far gets clipped, which shows up as black sky above the horizon and a
      // pale disc where the sphere meets the clip plane. The dome is re-centred
      // on the camera every frame, so a modest radius is not a limitation.
      radius = 1200,
    } = opts;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: new THREE.Color(top) },
        uHorizon: { value: new THREE.Color(horizon) },
        uSunColor: { value: new THREE.Color(sunColor) },
        uSunDir: { value: sunDir.clone() },
        uBands: { value: bands },
      },
      vertexShader: vert,
      fragmentShader: frag,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });

    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 20), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.name = 'sky';
    scene.add(this.mesh);

    this.horizonColor = new THREE.Color(horizon);
  }

  /** Keep the dome centred on the camera so it can never be escaped. */
  update(camera) {
    this.mesh.position.copy(camera.position);
  }

  setTime(topColor, horizonColor, sunColor) {
    this.material.uniforms.uTop.value.set(topColor);
    this.material.uniforms.uHorizon.value.set(horizonColor);
    this.material.uniforms.uSunColor.value.set(sunColor);
    this.horizonColor.set(horizonColor);
  }
}
