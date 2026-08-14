# Peggy

A mobile-first, toon-shaded third-person pirate adventure. Peggy is a
cyclops-octopus pirate with a hook for one hand and a peg for one leg, and the
whole game is built around what those two things let her do.

Three.js, native ES modules, **no build step**. Open `index.html` and it runs.

```sh
npm start          # serve on :8123
npm test           # controller regression checks + a render smoke test
```

Add `?q=low` or `?q=high` to force a quality tier, `?debug` to log it.

---

## Where it is

Locomotion and traversal are in and playable. There is no combat, no enemies,
no objectives, and no audio yet — this is the movement layer plus a test island
to exercise it.

| Working | Not yet |
|---|---|
| Twin-stick touch, keyboard+mouse, gamepad | Combat, enemies, damage |
| Run / jump / fall / land, with momentum | Audio |
| Surface swimming and free 3D diving | Real levels (there is one test island) |
| Hook: swing, reel, haul | Underwater rig (see below) |
| Toon shading, ink outlines, toon sea | Save state, menus, HUD proper |
| Follow camera with collision | The actual Peggy model — a proxy stands in |

---

## The control scheme

Mobile-first is a design constraint, not a port target: **if a verb can't be
reached with two thumbs, it doesn't go in.** Both other input methods are
mapped onto the same intent struct, so nothing downstream asks what device
you're on.

| | Touch | Keyboard / mouse | Gamepad |
|---|---|---|---|
| Move | left stick | `WASD` | left stick |
| Look | right stick | mouse | right stick |
| Jump | **tap** left stick | `Space` | A |
| Hook | **tap** right stick | left click | RT |
| Dive | **flick** left stick down | `C` | B |

Tapping the stick you're already holding is what buys the extra buttons —
a tap and a push are distinguishable (travel + duration + peak deflection), so
jump and hook cost no screen space.

The sticks are **floating**: each owns an invisible half of the screen and its
centre appears wherever your thumb lands. You never look at your thumbs, so a
stick that stays put is a stick you spend the whole game hunting for.

### The hook is one button and four verbs

The player never picks a mode — the world decides, based on what the hook hits:

| Target | Verb |
|---|---|
| anchor above her | **swing** — pendulum; push forward to climb the rope, tap to release with a boost |
| anchor at her level | **reel** — yanks her to it |
| a loose object | **haul** — yanks it to her |
| nothing | whiff, retract |

On a touchscreen you can't afford a mode selector, so the geometry has to
disambiguate. Aiming is a generous cone with assist, and the hook re-aims at
the resolved target once it's chosen.

---

## Layout

```
index.html            markup + touch control DOM
styles.css            HUD, sticks, boot screen. Safe-area aware.
src/
  main.js             boot + per-frame wiring
  core/
    loop.js           fixed 120Hz physics step, clamped dt
    math.js           dt-correct damping (half-lives, not lerp factors)
    quality.js        LOW/HIGH tiers — LOW is the default
  input/
    Joystick.js       floating virtual stick, tap/flick detection
    Input.js          touch + kbm + gamepad -> one intent struct
  player/
    Peggy.js          the character controller. Start here.
    Hook.js           grapple: swing / reel / haul
    PeggyModel.js     procedural proxy + the rigged-GLB loader
  camera/
    FollowCamera.js   third-person follow, orbit, collision
  render/
    toon.js           toon material, rim light, ink outlines, lighting
    sky.js            banded sky dome
    water.js          waves, toon banding, depth-buffer shoreline foam
  world/
    Level.js          analytic collision — heightfield + boxes + cylinders
    testIsland.js     "Grog Cay", the locomotion gym
tests/
  locomotion.mjs      deterministic controller checks (the important one)
  smoke.mjs           boots, renders, screenshots
```

### Two things worth knowing before editing

**Units are metres and seconds.** Peggy is 1.55 m tall, runs at 6.5 m/s, jumps
1.6 m. Sea level is `y = 0` everywhere.

**Smoothing is frame-rate independent.** Use `damp(current, target, halfLife,
dt)`, never a constant per-frame lerp factor — those judder as soon as frame
times vary, and the judder gets blamed on the movement code.

---

## The test island

`testIsland.js` is a locomotion gym dressed as a pirate island. Each piece
exercises one thing, and `npm test` asserts against them:

- **the beach** — wading in and out, the swim↔walk handover
- **the stair crates** — rises of 0.35 / 0.50 / 0.70 m against a 0.52 m step
  height, so the first two are walkable and the third must be jumped
- **the gap** — 3.4 m (comfortable) and 4.2 m (tight) against a 4.44 m running
  jump; neither clearable from a standstill
- **the mast** — swing anchors at three heights, crow's nest reachable only by
  swinging
- **the wreck** — reel anchors and a roof
- **the lagoon** — deep water, diving, sea floor
- **the spire** — too steep to walk; pushing into it must make you slide

If a movement change breaks something, it breaks here first and visibly.

---

## Dropping in the real model

Put a rigged `peggy.glb` in `models/` and it's picked up automatically — no
code change. See `models/README.md` for scale, orientation and the clip names
the loader looks for. Until then `ProxyPeggyModel` builds her from primitives:
one eye, hook arm, peg leg, and a limp in the walk cycle. It's a placeholder,
but a deliberate one — you cannot tune whether a run feels heavy by watching a
capsule.

The **underwater rig** you mentioned wanting has a clean seam: the controller
already exposes `peggy.inWater`, so either ship both skeletons in one `.glb`
and let clip names sort it out, or branch the loader on that flag.

---

## Credit where it's due

The input and camera layers are carried forward from **Robits**, which earned
these behaviours the hard way: floating sticks, the flick-peak latch, capped
camera yaw lag, and smoothing the *intent* vector rather than the velocity.
They're rewritten here rather than copied, but the design is Robits'.
