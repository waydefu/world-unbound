# Architecture

Accepted decisions: [ADR-0001](../adr/0001-engine-architecture.md) (engine stack) and [ADR-0002](../adr/0002-target-architecture.md) (target architecture, owner decisions, render bundles). This page is the **module map**; `scripts/audit.mjs` enforces it in CI (`app-checks`).

## Module layers

```
                       app  (composition root: App, streaming, clock, params, telemetry)
                    /   |   \
                render  ui   \
                 |  \    |    \
                 |  platform   |
                 |   /   |  \  |
              world    perf    env      (pure core: no DOM, no three.js, no imports outside own dir)
```

| Directory | May import | Purity | Responsibility |
| --- | --- | --- | --- |
| `src/world` | own directory | pure, deterministic | Height lattice (2 m cells, Int16 at 2 cm + 600 m offset) read from the installed baked tiles (`terrainData.ts`, `heightField.ts`), terrain colour weights, GPU texture packing (`terrainTextures.ts`), CDLOD node selection (`cdlod*.ts`), chunk grid and LOD, chunk request bookkeeping, worker job (`terrainJob.ts`) |
| `src/perf` | own directory | pure | Frame statistics, dynamic resolution controller, memory partitions and budgets |
| `src/env` | own directory | pure | Calendar (32-day year), sun/moon ephemeris at 62.083° N, atmosphere tables (Hillaire 2020), time-sliced sky-view table, weather type, climate state (season, temperature, wind direction/speed/gust; `climate.ts`) and local wind with fjord channelling (`wind.ts`) |
| `src/platform` | world, perf, env | browser | Capability probe (WebGPU adapter, limits), crash-recovery session flag |
| `src/render` | world, perf, env, platform | three.js | Renderer creation and fallback, warm-up, device-loss watch, CDLOD terrain (`cdlodTerrain.ts`, `cdlodShader.ts`; instanced patches displaced from a height texture) or, behind `?terrain=chunks`, terrain chunk meshes in a `BundleGroup`, sky dome, environment lights/fog/exposure, cascaded shadows |
| `src/ui` | platform | DOM | HUD and debug buttons; receives everything it shows from app |
| `src/app` | everything | browser | `App` (frame loop, cameras, recovery), terrain tile loader (`terrainAssets.ts`), terrain backends (`cdlodBackend.ts` default, `chunkBackend.ts` for `?terrain=chunks`) with the streamer/client/worker, environment clock, URL params, quality tiers, telemetry report and HUD text |
| `src/main.ts` | everything | browser | Boot: capabilities → quality tier → `App.create` |

Rules enforced by `scripts/audit.mjs`, besides the layer table:

- pure directories use no DOM globals and import only from their own directory;
- every `src/` directory must have a layer entry (a new directory fails the audit until the table is extended);
- functions reachable from the frame loop are tagged `@hot` (no allocation) or `@amortized` (bounded work);
- no GPU→CPU readback, no `SharedArrayBuffer`, no root-absolute URLs; files ≤ 350 lines; build size budget.

`spike/` (engine and GPU-ramp experiments, separate page) may import from `src/` but nothing in `src/` imports `spike/`.

## Frame and data flow

1. **Boot** (`main.ts`): capability probe, quality tier (`low` / `med` = mobile / `high`), `App.create`.
2. **App constructor**: environment (lights, sky, sea), atmosphere tables built once (~0.25 s desktop; `environment.atmosphereLutMs` in telemetry), shadows attached per tier, terrain chunks, streamer, HUD.
3. **Renderer**: WebGPU if an adapter works, else the flagged WebGL2 path; pipelines compiled up front (`warmUp`); device loss rebuilds the renderer on a new canvas.
4. **Each frame** (`App.frame`, `@hot`): frame stats → dynamic resolution → terrain update (CDLOD: select and cull nodes; chunks: worker jobs in, meshes applied) → world translated by −camera (camera-relative rendering) → environment clock (sky rows, exposure) → render.
5. **Every 500 ms** (`lowFrequency`): telemetry state, HUD text, world-ready detection.

## Terrain data flow

Real terrain (Hellesylt, G1.5, [spec](../specs/g1.5-real-terrain.md)) is baked once, offline, and committed:

1. `scripts/terrain/bake-hellesylt.mjs` (manual, not part of the build or CI) downloads Kartverket DTM 1 m, resamples to a 2048 x 2048 lattice at 2 m, synthesises seabed, quantises to Int16 and writes 16 tiles of 512 x 512 samples (row-delta, deflate-raw) to `assets/terrain/hellesylt/` plus `assets/manifests/terrain-hellesylt.json` (sha256, licence, pipeline version).
2. At boot `src/app/terrainAssets.ts` fetches the tiles (bundler-resolved relative URLs), checks every sha256 against the manifest (a mismatch stops the boot with an error), inflates them with `DecompressionStream('deflate-raw')` and calls `installTerrain` in the world core. The terrain worker does the same for its own copy before it answers jobs. Tests install the same files with `node:zlib` (`tests/setup/terrain.ts`).
3. `src/world/terrainData.ts` (pure; no fetch, no DOM) decodes and stores the lattice; `heightField.sampleQuantized` reads it, returns -55 m outside the 4096 m square and throws if nothing is installed. Everything else (chunk tiles, meshes, AO, sea floor, collision) derives from that one function.

## Terrain rendering (G2.0, [ADR-0003](../adr/0003-gpu-terrain-cdlod.md))

Default (`?terrain=cdlod`): after the worker installs the tiles it derives GPU copies of the lattice once (`world/terrainTextures.ts`): a 2049² R32F height texture, an RGBA8 material texture (sand, rock, earth weights and baked AO, the values the chunk path writes into vertex colours; 4 m texels on the low tier) and a min/max height pyramid. The CPU lattice stays the authority. Each frame `world/cdlod.ts` selects quadtree nodes (64 m to 4096 m, one 32 x 32 grid patch for all, distance ranges `lod0Distance` x 2^level, neighbours balanced to differ by at most one level), culls them against the camera frustum and writes them into instance buffers; one instanced draw displaces the patch in the vertex shader (`textureLoad`, geomorphing, edge stitching). Shadow casters are separate instanced draws on shadow-only layers, one per cascade, culled against that cascade's light frustum. The far-terrain skin is not used. `?terrain=chunks` keeps the previous path (CPU chunk meshes, streamer, far skin) for A/B and rollback.

## Vegetation, wind and grass (G2.1, [spec](../specs/g2.1-wind-grass.md))

- **Climate** (`env/climate.ts`) is a pure function of (seed, game time, weather, day of year): season, temperature (with the -6.5 C/km lapse as `temperatureAtAltitude`), wind direction (slow seeded noise, hours), speed (per weather, minutes) and gust factor (seconds). `windDirRad` is the bearing the wind blows towards; telemetry and the HUD show the bearing it blows from.
- **Fjord channelling** (`world/windChannel.ts`) is baked once in the terrain worker: a 256² map (16 m cells) of the valley axis (double-angle encoding of the gradient structure tensor) and sky openness. `env/wind.ts` turns the global wind into the local wind. `render/windTexture.ts` writes a camera-centred toroidal 64 x 64 RGBA16F field (8 m cells) at 10 Hz (32 KiB per refresh, about 0.3 MiB/s counted as upload).
- **Vegetation mask** (`world/vegetationMask.ts`, `world/manMadeStone.ts`) is baked in the same worker call as the material texture, on the same lattice: RGBA8 meadow / heath / tree / bare, an R8 wetness proxy, and the final sand, rock and stone weights written back into the material texture (`classifyTerrain` and the chunk path are untouched). Constants (`ROCK_SLOPE_DEG`, `TREELINE_M`, ...) cite `docs/research/env/6-hellesylt-flora.md` or are marked `unverified`.
- **Grass** (`world/grassCells.ts`, `render/grass*.ts`): camera-centred 8 m cells on a snapped grid, culled on the CPU, drawn as up to three instanced draws (dense 3-segment blades, thin 2-segment blades that are every fourth dense blade, cards). Nothing is stored per blade or clump: a cell holds 96 hashed clumps, a blade index maps to a clump, and the vertex shader scatters the blade around the clump centre, picks the species archetype (pasture, hay meadow, tussock, heath) per clump and bends it (rest lean plus wind). Colour is the terrain's ground colour at the root (`render/grassPalette.ts`), the tip lifted; blades fade by dropping (hash threshold), cards and the terrain shader's tip noise carry the field beyond. `?grass=0` disables it; the chunk path has none.
- **Calm basins** (`world/basinOpenness.ts`): an R8 map (8 m cells) of the fraction of 16 directions with more than 150 m of open water; the ocean shader drops foam and narrows the shallow band where it is below 0.25.
- Wiring lives in `app/vegetationBackend.ts` (climate, wind texture, grass, ocean wind and openness) and `app/appState.ts`.

## Contracts

- [System invariants](../contracts/system-invariants.md) (proposed)
- [Save schema](../contracts/save-schema.md) (no saves exist yet)
- Units: lengths in metres; sky tables give radiance for solar illuminance 1, the scene uses π (see `src/render/environment.ts`); exposure is folded into lights and sky (pre-exposure), `renderer.toneMappingExposure` stays 1.
- Coordinates: +x east, +y up, +z south; the camera stays at the origin.
