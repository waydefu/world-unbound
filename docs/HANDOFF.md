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
| G1.2 | Cascaded sun shadows; main-app terrain in a render bundle | Merged (#15) |
| — | Stop-work: module layers enforced, index, governance status, this handoff | Merged (#15) |
| G1.3 | Terrain PBR materials (weathering, slope/height blending) | In progress (local) |
| G1.4 | Ocean (multi-band waves, shoreline, reflections) | Not started |
| G1.5 | Real terrain: Hellesylt, Norway (Kartverket DTM, baked tiles, 62.083° N sun, new cameras, credits) | Implemented locally (phases A–C, [spec](specs/g1.5-real-terrain.md)); phase D visual review pending |

What the screen shows today: terrain, coastline, physical sky with sun/moon/stars, fog, terrain shadows, a flat placeholder sea. No buildings, vegetation, gameplay or audio.

## Measurements to build on

Owner's phone: Adreno 8xx, Chrome 157, WebGPU, 60 Hz, 2.2 MP drawing buffer.

- Render bundles cut CPU per frame from ~7 ms to ~1.6–2.3 ms ([engine spike](spikes/engine-spike.md)).
- GPU ramp (2026-11-17): 60 FPS held up to 5 full terrain passes, dropped at 6 → one pass ≈ 2.8–3.3 ms at full clocks. Per-pass timestamps read 11–13 ms because the GPU down-clocks when lightly loaded; use the ramp, not raw timestamps.
- Budget: target ≈ 11.5 ms GPU per frame (30 % thermal margin) → ≈ 3 ms base scene + ≈ 8 ms for G1 effects. Shadows are allotted 1.5–3 ms.
- Not yet measured: shadow cost on device, sustained (10 min+) thermal behaviour, atmosphere table build time on the phone (`environment.atmosphereLutMs`).

## Next actions

**Owner**

1. Review and merge the G1.3 PR.
2. Bundles + shadows are verified on the phone (WebGPU, med tier, 58.7 FPS at 2.2 MP). The shadows-off A/B was invalid (a false crash-recovery forced the low tier; fixed in G1.3), so after merging: in **one tab**, open `?cam=5&hour=19.8`, export JSON, then change the URL to `?cam=5&hour=19.8&shadows=0`, reload, export JSON.
3. Optional: second GitHub account for T20.

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
- Terrain is the real Hellesylt DTM (G1.5). The world is a 4 km square; the sea floor skin is half-float (1 m steps above 1024 m) and the material rules still key on height (everything below 2.4 m is sand, so the flat village reads as beach); the single seabed cell next to land gives a dark 2 m drop at every shore.
- `vite build` warns that `spike/threeRunner.ts` is both statically and dynamically imported (spike only, harmless).
