# Agent code routing map (small, deliberately curated)

Start with [AGENTS.md](../../AGENTS.md) and the dated [HANDOFF](../HANDOFF.md). This is a **task → likely files → tests** map, not a frozen call graph. Confirm actual symbols using `tools/agent-index.mjs` and check current feature flags. No complete code dump or vector index is required.

| Task | First entrypoints | Related tests |
| --- | --- | --- |
| Boot / renderer / device fallback | `src/main.ts`, `src/render/renderer.ts`, `src/platform/capabilities.ts` | `tests/perf.test.ts` (partial) |
| App frame loop, parameters, quality | `src/app/App.ts`, `src/app/params.ts`, `src/app/quality.ts` | `tests/perf.test.ts`, `tests/observability.test.ts` |
| Real terrain data / heights | `src/app/terrainAssets.ts`, `src/world/terrainData.ts`, `src/world/heightField.ts` | `tests/terrainData.test.ts`, `tests/world.test.ts` |
| CDLOD selection and renderer | `src/app/cdlodBackend.ts`, `src/world/cdlod.ts`, `src/render/cdlodTerrain.ts` | `tests/cdlod.test.ts`, `tests/cdlodSeams.test.ts` |
| Grass geometry and selection | `src/app/vegetationBackend.ts`, `src/render/grass.ts`, `src/world/grassCells.ts` | `tests/grass.test.ts` |
| Grass shading and light | `src/render/grassMaterial.ts`, `src/render/grassSpecimenMaterial.ts`, `src/render/grassCanopy.ts` | `tests/grass.test.ts`, blind visual review |
| Climate, wind, weather | `src/env/climate.ts`, `src/env/wind.ts`, `src/world/windChannel.ts` | `tests/climate.test.ts`, `tests/windChannel.test.ts` |
| Ocean / basin | `src/render/ocean.ts`, `src/render/oceanMaterial.ts`, `src/world/basinOpenness.ts` | `tests/ocean.test.ts`, `tests/basinOpenness.test.ts` |
| GPU and frame telemetry | `src/app/report.ts`, `src/app/observability.ts`, `src/perf/frameStats.ts` | `tests/observability.test.ts`, `tests/perf.test.ts` |
| Cameras / phone quality acceptance | `src/app/cameras.ts`, `src/app/quality.ts`, `docs/process/visual-review.md` | `tests/grass.test.ts`; phone evidence is separate |

## Narrow-first workflow

```bash
git ls-files 'src/*/*grass*'
node tools/agent-index.mjs find GrassCells --limit 5
node tools/agent-index.mjs calls select --file src/world/grassCells.ts --limit 8
node tools/agent-index.mjs impact src/world/grassCells.ts --limit 8
rg -n -C 3 -F 'GrassCells' src/render tests
```

The tool computes its AST and type information **on demand** from tracked TypeScript files and the existing installed `typescript` dependency. `calls` reports static resolvable call sites, not a complete runtime call graph. `impact` follows relative static import/export edges and may omit side-effect code, type-only implicit dependencies, generated assets and runtime imports. Inspect the target code and run the relevant tests before changing it.

For Agent reliability and token-efficiency goals, use the reproducible [benchmark protocol](../process/index-benchmark.md). Re-check or update this map when file responsibilities move; never add unsupported function-level facts.
