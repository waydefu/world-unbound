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
| `src/world` | own directory | pure, deterministic | Height lattice (2 m cells, 1 cm quantised), terrain shape and colour, chunk grid and LOD, chunk request bookkeeping, worker job (`terrainJob.ts`) |
| `src/perf` | own directory | pure | Frame statistics, dynamic resolution controller, memory partitions and budgets |
| `src/env` | own directory | pure | Calendar (32-day year), sun/moon ephemeris at 53.9° N, atmosphere tables (Hillaire 2020), time-sliced sky-view table, weather type |
| `src/platform` | world, perf, env | browser | Capability probe (WebGPU adapter, limits), crash-recovery session flag |
| `src/render` | world, perf, env, platform | three.js | Renderer creation and fallback, warm-up, device-loss watch, terrain chunk meshes in a `BundleGroup`, sky dome, environment lights/fog/exposure, cascaded shadows |
| `src/ui` | platform | DOM | HUD and debug buttons; receives everything it shows from app |
| `src/app` | everything | browser | `App` (frame loop, cameras, recovery), terrain streamer/client/worker, environment clock, URL params, quality tiers, telemetry report and HUD text |
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
4. **Each frame** (`App.frame`, `@hot`): frame stats → dynamic resolution → streamer update (worker jobs in, meshes applied) → world translated by −camera (camera-relative rendering) → environment clock (sky rows, exposure) → render.
5. **Every 500 ms** (`lowFrequency`): telemetry state, HUD text, world-ready detection.

## Contracts

- [System invariants](../contracts/system-invariants.md) (proposed)
- [Save schema](../contracts/save-schema.md) (no saves exist yet)
- Units: lengths in metres; sky tables give radiance for solar illuminance 1, the scene uses π (see `src/render/environment.ts`); exposure is folded into lights and sky (pre-exposure), `renderer.toneMappingExposure` stays 1.
- Coordinates: +x east, +y up, +z south; the camera stays at the origin.
