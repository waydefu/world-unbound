# Handoff

Snapshot: 2026-11-17, work paused at the owner's request after G1.2. Read this, then [INDEX.md](INDEX.md).

## Where the project is

- **Live build:** https://waydefu.github.io/world-unbound/ (deployed from `main` by `pages.yml`); spike page at `/world-unbound/spike/engines.html`.
- **Governance:** M0 complete, M1 complete on the agent side ([status](governance/status.md)).
- **Game:** G0 engine skeleton done; G0.5 engine decision done, erosion bake deferred; G1 in progress:

| Step | Content | State |
| --- | --- | --- |
| G1.0 | GPU load ramp on the spike page | Merged (#13); phone result below |
| G1.1 | Physical sky and atmosphere, calendar, ephemeris, auto-exposure | Merged (#14) |
| G1.2 | Cascaded sun shadows; main-app terrain in a render bundle | PR #15 open, CI green, awaiting owner review |
| — | Stop-work: module layers enforced, index, governance status, this handoff | On the agent branch with/after #15 |
| G1.3 | Terrain PBR materials (weathering, slope/height blending) | Not started |
| G1.4 | Ocean (multi-band waves, shoreline, reflections) | Not started |

What the screen shows today: terrain, coastline, physical sky with sun/moon/stars, fog, terrain shadows, a flat placeholder sea. No buildings, vegetation, gameplay or audio.

## Measurements to build on

Owner's phone: Adreno 8xx, Chrome 157, WebGPU, 60 Hz, 2.2 MP drawing buffer.

- Render bundles cut CPU per frame from ~7 ms to ~1.6–2.3 ms ([engine spike](spikes/engine-spike.md)).
- GPU ramp (2026-11-17): 60 FPS held up to 5 full terrain passes, dropped at 6 → one pass ≈ 2.8–3.3 ms at full clocks. Per-pass timestamps read 11–13 ms because the GPU down-clocks when lightly loaded; use the ramp, not raw timestamps.
- Budget: target ≈ 11.5 ms GPU per frame (30 % thermal margin) → ≈ 3 ms base scene + ≈ 8 ms for G1 effects. Shadows are allotted 1.5–3 ms.
- Not yet measured: shadow cost on device, sustained (10 min+) thermal behaviour, atmosphere table build time on the phone (`environment.atmosphereLutMs`).

## Next actions

**Owner**

1. Review and merge PR #15 (and the stop-work changes).
2. On the phone, open `?cam=5&hour=19.8` and `?cam=5&hour=19.8&shadows=0`, export telemetry JSON from each (HUD → JSON). This verifies bundles + shadows on WebGPU (untested in CI) and gives the shadow cost.
3. Merge PR #16 (governance gaps 4 and 5 from [governance/status.md](governance/status.md): `scripts/**` at R3, `src/env/**` owner domain; without the `tests/**` line).
4. Optional: second GitHub account for T20.

**Next agent session**

1. Analyse the two telemetry files; if shadows exceed ~3 ms, reduce cascades or map size per tier in `src/app/quality.ts`.
2. G1.3 terrain materials, then G1.4 ocean, each as its own PR with before/after screenshots of the six cameras.
3. Wire `materialVariants` telemetry to the real pipeline count.
4. After G1: 10-minute thermal run, then revisit the erosion bake ([findings](spikes/terrain-erosion.md)).

## How to resume

```
npm ci --ignore-scripts
npm run dev                 # http://localhost:5173/world-unbound/
npm run check               # lint, typecheck, tests, build, static audit, visual audit
```

- Agent branch: `ccr-249f8f67-fulgp3` (never push to `main`). After a squash merge, restart the branch from `origin/main` and push again.
- Every PR: follow the template, `Refs #`, list tests not run, say that AI summaries are not CI proof. The owner merges; agents never approve or merge.
- Protected paths (`governance/`, `.github/`, `AGENTS.md`) need an explicit, task-scoped owner authorisation.
- The headless visual audit runs WebGL2 on SwiftShader only. Anything WebGPU-specific (bundles, timestamps) needs the phone.

## Known issues and debts

- Shadow cascades are texel-snapped in camera-relative space; a moving camera may shimmer (cameras are fixed today).
- Shadow passes still run at night (intensity 0) to avoid a pipeline rebuild at sunset.
- WebGL2 draw calls roughly triple with shadows (Lite tier); may need shadows off there.
- Atmosphere tables are built on the main thread at boot; move to a worker or bake if the phone time is high.
- Fog is exponential height-less fog, not a full aerial-perspective volume.
- Terrain is the procedural G0 shape; relief is low, so shadows are subtle until the bake lands.
- `vite build` warns that `spike/threeRunner.ts` is both statically and dynamically imported (spike only, harmless).
