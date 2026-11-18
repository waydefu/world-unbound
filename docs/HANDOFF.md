# Handoff

Snapshot: 2026-11-18, after G1.4.1 (PR #21, deploy fix #22). Read this, then [INDEX.md](INDEX.md).

## Where the project is

- **Live build:** https://waydefu.github.io/world-unbound/ (deployed from `main` by `pages.yml`; check the Actions run, a red unit test skips the deploy); spike page at `/world-unbound/spike/engines.html`.
- **Governance:** M0 complete, M1 complete on the agent side ([status](governance/status.md)).
- **Process:** subagents implement from a written spec (`.claude/agents/`), a render-only critic reviews screenshots ([visual review](process/visual-review.md)), the owner tests on the phone.
- **Game:** G0 done; G0.5 engine decision done; G1 in progress:

| Step | Content | State |
| --- | --- | --- |
| G1.0 | GPU load ramp on the spike page | Merged (#13) |
| G1.1 | Physical sky and atmosphere, calendar, ephemeris, auto-exposure | Merged (#14) |
| G1.2 | Cascaded sun shadows; main-app terrain in a render bundle | Merged (#15) |
| G1.3 | Terrain materials (weathering, slope/height blending) | Merged |
| G1.4 | Ocean (Gerstner waves, sea floor, far-terrain skin, lite tier) | Merged |
| G1.5 | Real terrain: Hellesylt, Norway (Kartverket DTM, 62.083° N) | Merged (#20) |
| G1.4.1 | Noise textures instead of per-pixel noise, near-field view radius, observability HUD, shore/night fixes | Merged (#21, #22); phone gate passed |

What the screen shows today: real fjord terrain, physical sky, fog, shadows, a shaded ocean with shore foam. No buildings, vegetation, rain, gameplay or audio.

## Measurements to build on

Owner's phone: Adreno 8xx, Chrome 157, WebGPU, 60 Hz, 2.2 MP drawing buffer, med tier.

- **G1.4.1 gate (2026-11-18), passed:** cams 2, 3, 5 hold 60 FPS at render scale 1.0 for 70 s (0 scale changes, p95 16.7–16.8 ms); 1–2 frames > 50 ms each, attributed by LoAF to terrain loading at start. Resident chunks 491 (was 1296), visible 53–73.
- **GPU ramp (2026-11-18):** the spike scene (terrain only, 1298 chunks, pinned 1300 m ring) holds 60 FPS up to 8 passes, drops at 10 → one pass ≤ 12.5 % of a frame, far above the 30 % headroom rule. It does not include ocean or shadows; the app numbers above are the real evidence.
- `gpu Σpass` (`frames.gpuPassSumP50Ms`) is the **sum of per-pass durations** from three.js, inflated by down-clocking and tiled-GPU overlap; it is not a frame time (11–13 ms at a steady 60 FPS).
- Render bundles cut CPU per frame from ~7 ms to ~1.6–2.3 ms ([engine spike](spikes/engine-spike.md)).
- Not yet measured: sustained (10 min+) thermal behaviour.

## Next actions

**Owner:** merge open PRs; T20 still needs a second GitHub account.

**Next agent session** (owner chooses the order):

1. G2 vegetation (camera-centred grass cells, blades near, cards mid; refs in [external projects](reference/external-projects.md)).
2. Weather: visible rain and cloud (blind review found rain nights unreadable as rain).
3. Chunk system: CDLOD geomorph, horizon beyond 4 km, terrain data streaming, occlusion culling.
4. Bathymetry realism (seabed is synthesised from distance to land; shallows look uniform).
5. End of G1: fly-through benchmark and 10-minute soak.

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
- Terrain is the real Hellesylt DTM (G1.5), a 4 km square; the far skin covers it beyond the streamed ring (600/800/1100 m by tier). The seabed is synthesised from the distance to land, so shallows have a uniform width.
- The near/far shadow-caster split (G1.4.1) saves nothing at current settings: shadow `maxFar` ≥ view radius, so every resident chunk casts. Shadow passes are small (≤ 0.12 M triangles per cascade on the phone).
- Ocean shading near the coast waits ~2 s for the 2 m coast map (built in the worker); until then the water reads as deep.
- `shaders.pipelinesAfterWarmup` reads three's private `_pipelines.caches` and becomes null if three moves it.
- Open blind-review findings (G1.4.1 round 2): smeared near meadow (needs vegetation), crushed-black cliff shadows (cam 2), narrow sun glitter and pale water at low sun (cam 3), no visible rain (cam 4).
- `vite build` warns that `spike/threeRunner.ts` is both statically and dynamically imported (spike only, harmless).
