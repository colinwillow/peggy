# Models

Drop `peggy.glb` in here and the game picks it up automatically — no code
change. Until it exists, `src/player/PeggyModel.js` falls back to the
procedural proxy, so the game always boots.

## What the loader expects

**Scale and orientation.** 1 unit = 1 metre. Peggy is about **1.55 m** tall
(that's `TUNING.height` in `src/player/Peggy.js` — change one, change the
other). Origin at the floor between her feet, facing **+Z**.

**Clips.** The loader matches by name, first hit wins, case-sensitive as
listed in `CLIPS`:

| Intent | Names it looks for        | When it plays                         |
|--------|---------------------------|---------------------------------------|
| idle   | `idle`, `Idle`            | grounded, speed ≈ 0                   |
| walk   | `walk`, `Walk`            | grounded, speedRatio > 0.08           |
| run    | `run`, `Run`              | grounded, speedRatio > 0.55           |
| jump   | `jump`, `Jump`            | airborne, rising                      |
| fall   | `fall`, `Fall`            | airborne, falling                     |
| land   | `land`, `Land`            | on landing                            |
| swim   | `swim`, `Swim`            | at the surface                        |
| dive   | `dive`, `Dive`            | submerged                             |
| hook   | `hook`, `Hook`            | throwing the hook                     |
| swing  | `swing`, `Swing`          | hanging from the rope                 |

Missing clips degrade quietly — the loader falls back to `idle` rather than
erroring, so you can deliver the rig with walk and run and add the rest later.

`walk` and `run` get their `timeScale` driven from actual ground speed, so
author them at a natural cadence and don't worry about matching the game's
metres-per-second exactly.

**Two rigs.** You mentioned wanting a separate water rig. The clean seam is
`RiggedPeggyModel` — either ship both skeletons in one `.glb` and let the clip
names sort it out, or add a second loader path keyed on `peggy.inWater`. The
controller already exposes that flag.

**Materials.** Whatever comes in gets re-materialled to `toonMaterial()`,
keeping the base colour and any `map`. So author flat colour or a single
albedo atlas; PBR maps will be discarded. Ink outlines are generated from the
geometry, so don't model them.


---

## Current state: glorp_character.glb

The interim rigged character, loaded automatically (a future `peggy.glb` will
beat it in the candidate order). Notes from wiring it, useful for the next
export:

- **No material in the file** — the texture lives at `images/glorp_texture.webp`
  and is bound by hand in `createPeggyModel` (`flipY = false`). Baking it
  into the GLB would let all of that disappear.
- **The texture stores LINEAR pixel values** — an sRGB→linear conversion got
  baked in somewhere in the export chain, so read normally it averages 7/255
  and the model renders as a black silhouette. The loader tags it
  `LinearSRGBColorSpace` so the renderer's output encode undoes the baked
  conversion and the painted colours come back. (An earlier note here blamed
  inverted normals for the black render — that was wrong. The normals are
  fine; "fixing" them just made the rim light glaze the whole body tan.
  If the next export bakes the texture into the GLB, the exporter will tag
  the colour space itself and this whole bullet evaporates.)
- **Scale/orientation are auto-normalised** at load: the loader poses the
  skeleton in idle frame 0, measures the SKINNED vertices, and sizes that to
  1.5m with feet at y=0 and the yaw axis through the middle. (Measuring the
  raw bind-space geometry — the first attempt — shipped him 2.8m tall,
  floating 1.1m up, spinning about an axis in front of his belly: bind space
  and render space genuinely disagree on this export.)
- **Takes map as**: idle, walk, run, running_jump -> jump, in_air -> fall,
  landing -> land. The `.001` duplicates, `tpose` and `CINEMA_4D_Main` are
  ignored.
- **The jump sequences as takeoff -> in-air -> landing**: `running_jump`
  plays once from the moment she leaves the ground (and again on the double
  jump), `in_air` holds for the whole rest of the arc — rising or falling —
  and `landing` plays on impact. Nothing is keyed on the apex, so there is no
  clip pop at the top of the arc.
- **The strafes are live**: while the right stick is held (the twin-stick
  aim), her facing is locked and `run_backward` / `left_strafe` /
  `right_strafe` are chosen from where the velocity points in her frame.
- **Clips are cleanly in-place** (hips drift ~2cm) — keep authoring that way,
  the controller owns all world movement.
- **Still missing**: swim, dive, hook throw, swing, melee clips. Their states
  currently fall back (swim/swing/dive -> in_air, melee -> locomotion + the
  swipe arc effect).
