# Working on Peggy

## Anything meant for testing goes to `main`

The loop here is: you make a change, it goes live on GitHub Pages, and it gets
played on a phone. **Pages serves `main`**, so a change sitting anywhere else
cannot be tested — that's the whole constraint, and it's the only one.

So: **branch as much as you like.** Experiments, risky refactors, two competing
approaches side by side — all fine, and leaving old branches lying around is
fine too. Nobody minds them existing.

What doesn't work is ending a requested change on a branch. "It's done, it's on
`claude/whatever`" means it can't be played, so it isn't done. Merge to `main`
and push before you report back. If a change turns out bad it gets reverted;
that's cheap, and cheaper than a review step nobody performs.

Don't open a pull request unless asked — it's an extra click between the work
and the phone it needs to run on.

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
