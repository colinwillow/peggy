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
| Melee swipe (knocks loose props) | Guns / projectiles |
| Context interact: chest, door, helm | Dialogue, inventory |
| Toon shading, ink outlines, toon sea | Save state, menus, HUD proper |
| Follow camera with collision | The actual Peggy model — a proxy stands in |

---

## The control scheme

Mobile-first is a design constraint, not a port target: **if a verb can't be
reached with two thumbs, it doesn't go in.** Both other input methods are
mapped onto the same intent struct, so nothing downstream asks what device
you're on.

**No on-screen buttons.** Every verb is a stick gesture.

| | Touch | Keyboard / mouse | Gamepad |
|---|---|---|---|
| Move | left stick | `WASD` | left stick |
| **Shoot** | **push** right stick — she turns, camera follows, cannon fires while held | hold click | RT |
| Centre camera | **tap** left stick | `R` | L3 |
| Turn camera | (the aim owns it — push to look) | mouse X, or `Q`/`E` | right stick X |
| Dive | **flick** left stick down | `C` | B |
| Jump / **Interact** | **tap** right stick — tap again in the air to **double jump** | `Space` | A |
| Melee combo | **flick** right stick — chain three: forehand, backhand, spin | right-click, or `V` | X |
| Hook | *off the stick while it's redesigned* | `F` | RB |

### The four gestures

The right stick carries camera, jump, melee and hook on one thumb, told apart
by deflection over time:

| Gesture | Motion | Verb |
|---|---|---|
| **tap** | down, barely moves, up fast | jump (again in the air: double jump) |
| **push** | out past the trigger zone, held | SHOOT — she turns there, the camera swings behind, the cannon fires while held |
| **flick** | snapped out and released/rebounded | melee — chain three for the combo |

(The swipe-camera and the stick-hold hook described below are retired from
touch in this revision — the right stick is the shoot stick, Robits-style,
and the hook is being redesigned onto a different input.)

**The camera is swipe-based**, not deflection-based: it pans while the thumb
MOVES and stops when the thumb stops. That is what makes "press and hold in a
direction, release to launch" possible at all — under the old rate-based
camera, a held-out thumb WAS the camera, so that posture could never mean aim.
Now a thumb that rests for ~0.4s becomes the aim no matter how far out it sits,
the arc appears, and release throws in the held direction.

A fast pan and a flick are both fast, so a flick is a CANDIDATE until the
thumb releases or rebounds (melee) or keeps travelling past 200ms (it was a
pan). Camera pixels are buffered while that's undecided — dropped on a melee,
flushed on a pan — so a swipe never fires a sword and a sword never whips the
view.

**Holding shows the throw — and a hold is twin-stick.** From the moment the
hold engages, a dashed gold arc draws the rope's flight path, the lock-on
diamond marks what the assist has picked, and deflecting the stick steers the
throw — release to commit. While it's held, the stick is the second stick of
a twin-stick game: she FACES the held direction, the camera eases around
behind it, and the left stick keeps moving her in screen space — run
backwards while looking forward, strafe across a target, circle a crab with
the throw charged. The `run_backward` / strafe clips key off exactly this
state. The aim reads against the camera yaw FROZEN when the hold engaged;
read the live yaw instead and it feeds back through the chasing camera — a
held diagonal would orbit forever instead of settling.
A touch that starts as a camera drag can never become an aim, and a touch
that has flicked can never become one either, so combo mashing and camera
play never trip into a hook throw.

**The melee is a three-hit combo.** Forehand, backhand, then a full spin that
hits all the way around and hits harder — each stage has its own animation
and swipe trail, and the chain window is ~0.6s, so it reads as rhythm rather
than mashing. Flicks landed mid-swing are queued, not dropped.

Tap and hold are the same motion split by *duration*; flick and push are the
same motion split by **speed** — radial deflection per second, not "got far
within a time window". The window version fired melee on ordinary camera drags,
because a deliberate drag crosses the same distance easily inside it. A real
flick runs 10-15 units/sec; a drag runs 2-4. The threshold sits in the gap.

The hold zone and the camera's deadzone are **the same number**. Anywhere your
thumb can rest and still count as a hold is guaranteed not to have nudged the
camera, so the two can never half-fire each other. It's set generously — a thumb
resting on glass wanders more than you'd think, and a tighter zone meant the
hook simply never fired.

The camera also doesn't start turning until the thumb has been out for ~95 ms.
Muting after a flick fires isn't enough on its own: the wind-up frames leaked
about 11° of yaw into every melee. A flick is over before the window elapses,
so it now contributes nothing.

`tests/gestures.mjs` pins all of this with real touch events at human speeds.

**The camera's tilt is fixed.** You rotate around her, you never pitch. Giving
up that axis is what leaves room for the gestures above; guns and interact will
join the same thumb rather than growing a button row.

**The left stick is locomotion and nothing else.** Tapping it recentres the
camera behind her, so a player who only wants to run around never has to
involve their right thumb at all.

### Interact is jump

Same tap, different verb by proximity. Walk near a chest, a door or the ship's
wheel and the right stick grows a flashing gold ring with the icon of the thing
on it — tap and you use it instead of hopping.

The prompt lives **on the stick** rather than in a corner of the HUD, because
the stick is the thing you're about to press. You learn the verb by looking at
the thumb that performs it.

Because interact steals a jump, `findInteractable` requires her to be turned
toward the thing (unless she's stood right on it, where facing stops meaning
anything). That keeps the theft deliberate.

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
disambiguate. The hook re-aims at the resolved target once it's chosen.

**Aiming is horizontal only.** The camera's tilt is fixed, so the player has no
way to aim up — and every swing anchor is overhead by design. Scoring the full
3D angle put the mast rigging right on the edge of the cone, so throwing at it
worked or missed essentially at random. Horizontal heading is the only thing
the player controls, so it's the only thing that picks the target.

**Latching from the ground yanks her up.** The rope shortens so the bottom of
the arc clears the terrain, and there's a grace window before the
ground-collision check applies — without either, a swing started on foot ends
on the first physics step, before it visibly begins.

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

**Units are metres and seconds.** Peggy is 1.55 m tall, runs at 7.2 m/s, jumps
2.6 m. Sea level is `y = 0` everywhere.

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
- **the gap** — 3.4 m and 4.2 m against a ~7.7 m full-momentum running jump;
  neither clearable from a standstill
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
