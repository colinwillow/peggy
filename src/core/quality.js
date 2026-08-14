// Quality tiers.
//
// Mobile-first means the phone budget is the REAL budget and desktop is the
// one that gets the extras — not a desktop build with things switched off.
// So LOW is the honest default and everything here is a ceiling, not a floor.
//
// The detection is deliberately crude. There is no reliable way to ask a
// browser how fast its GPU is, and every clever heuristic ends up mis-tiering
// somebody's device. Core count and pointer type get it roughly right, and
// `?q=low|high` overrides it for testing on whatever's in your hand.

const params = new URLSearchParams(location.search);

function detect() {
  const forced = params.get('q');
  if (forced === 'low' || forced === 'high') return forced;

  const coarse = matchMedia('(hover: none) and (pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;

  if (!coarse && cores >= 8) return 'high';
  if (coarse && cores >= 8 && mem >= 6) return 'high';   // recent flagship phone
  return 'low';
}

const tier = detect();

export const QUALITY = {
  tier,
  isLow: tier === 'low',

  // Pixel ratio. Above 2 is invisible and quadratically expensive; on a phone
  // even 2 is usually a waste, and 1.5 buys a lot of headroom for very little
  // apparent softness.
  pixelRatio: tier === 'high' ? 2 : 1.5,

  // Water is the single biggest triangle sink — it's a full-screen plane with
  // vertex-displaced waves. The shading is computed per-pixel, so dropping
  // tessellation costs silhouette detail on the nearest crests and nothing else.
  waterSize: tier === 'high' ? 1400 : 900,
  waterSegments: tier === 'high' ? 320 : 180,
  waterDepthScale: tier === 'high' ? 0.5 : 0.35,

  // Terrain is generated once, so this is a memory/upload cost more than a
  // per-frame one — but it's still ~200k triangles at the top setting.
  terrainSize: 440,
  terrainSegments: tier === 'high' ? 300 : 200,

  shadowMapSize: tier === 'high' ? 2048 : 1024,
  shadowExtent: tier === 'high' ? 34 : 26,

  antialias: tier === 'high' && devicePixelRatio < 2,
};

if (params.has('debug')) console.info('[peggy] quality:', QUALITY);
