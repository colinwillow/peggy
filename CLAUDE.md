# Working on Peggy

## Ship to `main`. Don't hand over a branch.

This project has one branch and it is `main`. Commit there, push there, and the
change is live on GitHub Pages a minute later — which is how it gets tested,
on a phone, by the person who asked for it.

Branch locally if it helps you work. But **a branch is not a deliverable.** A
change parked on `claude/whatever` is a change nobody will ever play, and
"here's a branch for you to review" is not what was asked for. Merge it to
`main` and push before you report back.

Reverting is the safety net, not branching. If a change turns out bad, it gets
reverted — that's cheap, and it's cheaper than a review step that never happens.

Corollary: **don't open a pull request unless explicitly asked.** A PR against
`main` in a one-branch repo is just an extra click between the work and the
phone it needs to run on.

## Test before you push

```sh
npm test     # 26 deterministic controller checks + a render smoke test
```

`tests/locomotion.mjs` steps the controller directly at fixed dt, so the numbers
don't depend on how fast the renderer is. It has caught seven real bugs so far.
If you change anything in `src/player/` or `src/camera/`, expect those numbers
to move — update the expectations deliberately, and never loosen a range just
to make it green.

Two of those checks exist because *every other check passed while movement ran
backwards*. They all measured distance and none measured direction. When you
add a check, ask what it would still pass with.

## The bar for "done"

It runs on a phone, in landscape, with two thumbs. Not "it works if you also
have a keyboard". If a verb can't be reached with two thumbs, the design is
wrong — don't paper over it in the input layer.

## Conventions

- **Metres and seconds.** She's 1.55 m, runs 6.5 m/s, jumps 1.6 m. Sea level is
  `y = 0` everywhere.
- **No build step.** Native ES modules, vendored three.js. `index.html` opens
  and runs. Don't introduce a bundler without asking.
- **Frame-rate independent smoothing.** `damp(current, target, halfLife, dt)`,
  never a constant per-frame lerp factor.
- **Tuning lives in one object per system** — `TUNING` in `Peggy.js`, `CAM` in
  `FollowCamera.js`, `HOOK` in `Hook.js`. Put new numbers there, not inline.

## Open seams

- `models/peggy.glb` doesn't exist yet; `ProxyPeggyModel` stands in and the
  loader swaps automatically when it lands. See `models/README.md`.
- No combat, no audio, one test island.
- The right thumb's gestures are deliberately unspent — that's reserved for
  melee / shoot / interact.
