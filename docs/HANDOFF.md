# Handoff

Snapshot: 2026-11-19, after G2.1 (wind, vegetation mask, grass). Handing over to another agent (non-Claude): read this, then [process/agent-workflow.md](process/agent-workflow.md) (how work is done here, tools, environment), then [INDEX.md](INDEX.md). `AGENTS.md` is binding for every agent.

## Where the project is

- **Live build:** https://waydefu.github.io/world-unbound/ (deployed from `main` by `pages.yml`; check the Actions run, a red unit test skips the deploy); spike page at `/world-unbound/spike/engines.html`.
- **Governance:** M0 complete, M1 complete on the agent side ([status](governance/status.md)).
- **Process:** spec → implementation → render-only blind review → owner phone test → PR; described tool-neutrally in [agent workflow](process/agent-workflow.md) (`.claude/agents/` holds the Claude-specific versions of the same roles).
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
| G2.0 | CDLOD terrain from GPU height/material/normal textures ([ADR-0003](adr/0003-gpu-terrain-cdlod.md)); `?terrain=chunks` keeps the old path one release | Merged (#25); phone: 60 FPS at scale 1.0 on cams 2/3/5, 0 frames > 50 ms, 7 terrain draws |
| G2.1 | Climate state + fjord-channelled wind field; vegetation mask (green moderate slopes, rock > 42°, stone quays); grass (clumps, four species archetypes, curved blades, wind); calm harbour basins; fullscreen button | PR open; phone test pending ([spec](specs/g2.1-wind-grass.md)) |
| G2.0 | CDLOD terrain from GPU height/material/normal textures ([ADR-0003](adr/0003-gpu-terrain-cdlod.md)); `?terrain=chunks` keeps the old path one release | Merged (#25); phone: 60 FPS at scale 1.0 on cams 2/3/5, 0 frames > 50 ms, 7 terrain draws |

What the screen shows today: real fjord terrain, physical sky, fog, shadows, a shaded ocean, wind and grass. No trees, buildings, rain, player, gameplay or audio.

## Measurements to build on

Owner's phone: Adreno 8xx, Chrome 157, WebGPU, 60 Hz, 2.2 MP drawing buffer, med tier.

- **G1.4.1 gate (2026-11-18), passed:** cams 2, 3, 5 hold 60 FPS at render scale 1.0 for 70 s (0 scale changes, p95 16.7–16.8 ms); 1–2 frames > 50 ms each, attributed by LoAF to terrain loading at start. Resident chunks 491 (was 1296), visible 53–73.
- **GPU ramp (2026-11-18):** the spike scene (terrain only, 1298 chunks, pinned 1300 m ring) holds 60 FPS up to 8 passes, drops at 10 → one pass ≤ 12.5 % of a frame, far above the 30 % headroom rule. It does not include ocean or shadows; the app numbers above are the real evidence.
- `gpu Σpass` (`frames.gpuPassSumP50Ms`) is the **sum of per-pass durations** from three.js, inflated by down-clocking and tiled-GPU overlap; it is not a frame time (11–13 ms at a steady 60 FPS).
- Render bundles cut CPU per frame from ~7 ms to ~1.6–2.3 ms ([engine spike](spikes/engine-spike.md)).
- Not yet measured: sustained (10 min+) thermal behaviour.

## Next actions

**Owner:** merge open PRs; T20 still needs a second GitHub account.

**Next agent session** (order agreed with the owner; details in [environment research](research/environment-systems.md)):

1. **Finish G2.1** after the owner's phone test (tier budgets: med 40 blades/m², high 70; high is ~620 k grass triangles and unprofiled). Open blind-review findings (round 2, 2026-11-19): grass density ends in a visible line on cams 0/1 and still shows aligned streaks at med; sunrise cliffs (cam 3) read pink-beige; harbour basins still show a pale teal fill and a thin cyan shore line (cam 5); pier reads as dirt, not stone; cold near-black shadow shapes on cam 2; smeared ground texture under the grass; rock patches look stamped.
2. Weather W1/W2: layered clouds, fog layers, rain/snow, surface wetness, lightning (cam 4 rain night is still too dark and shows no rain).
3. Ocean O1: tide, wind-driven sea state, water colour and caustics, bathymetry constrained by Kartverket soundings.
4. Player controller (needed by S1 and gameplay), then S1 soil and ground system (footprints that recover, puddles after rain, mud).
5. Trees and shrubs (the vegetation mask's tree channel is ready), audio A1, ecology numbers with the economy (G3); terrain beyond 4 km and occlusion culling when needed.
6. End of G1: fly-through benchmark and 10-minute soak.

**Owner decisions still open:** game spec §4.5 lists Baltic flora (contradicts Hellesylt); a `src/audio` layer needs an audit change (`scripts/` is protected); real or compressed calendar; shared weather seed; rigid-body physics (Rapier) only after a phone spike; whether far cliffs keep real rock (current: yes, greener moderate slopes).

## How to resume

```
npm ci --ignore-scripts
npm run dev                 # http://localhost:5173/world-unbound/
npm run check               # lint, typecheck, tests, build, static audit, visual audit
```

- Work on a branch, never push to `main`; the owner squash-merges PRs. (Claude sessions used `ccr-249f8f67-fulgp3`; use whatever branch your tool assigns.) After a squash merge, restart the branch from `origin/main`.
- `npm run check:quiet` runs the same steps as `npm run check` with one line per step (add `-- --no-visual` to skip the headless visual audit).
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
- `vite build` warns that `spike/threeRunner.ts` is both statically and dynamically imported (spike only, harmless).
