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
