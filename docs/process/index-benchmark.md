# Agent search and token-efficiency evaluation (manual protocol)

Purpose: determine whether on-demand symbol discovery improves actual Agent outcomes. The CLI's short output is **not** an LLM Token count or a guarantee of speed/accuracy.

## Dataset (real files; verify current implementation at the chosen SHA)

For each task, ask an Agent to identify the responsible declaration, one meaningful caller or dependency and relevant tests **without full-repository dumps**. First attempt may use `git ls-files`/`rg`; second attempt uses `node tools/agent-index.mjs`. Use the same model, prompt, temperature, time budget and Git SHA.

| # | Question / symbol seed | Expected entrypoint |
| --- | --- | --- |
| 1 | Grass selection (`GrassCells`) | `src/world/grassCells.ts` |
| 2 | Grass drawing (`GrassLayer`) | `src/render/grass.ts` |
| 3 | Grass shading (`grassMaterial`) | `src/render/grassMaterial.ts` |
| 4 | CDLOD node choice (`cdlod`) | `src/world/cdlod.ts` |
| 5 | Terrain height sampling (`heightAt`) | `src/world/heightField.ts` |
| 6 | Clock / climate (`climate`) | `src/env/climate.ts` |
| 7 | Ocean rendering (`Ocean`) | `src/render/ocean.ts` |
| 8 | Telemetry report (`report`) | `src/app/report.ts` |
| 9 | Dynamic resolution (`dynamicResolution`) | `src/perf/dynamicResolution.ts` |
| 10 | URL parameter parsing (`parseParams`) | `src/app/params.ts` |

## Record and gate

For each task record: `repo_sha`, `model`, `mode` (baseline/with-index), `prompt`, `first_correct_file_rank`, `queries`, `exact input/output tokens from model usage`, `wall_ms`, `correct caller/test?` and `unexpected omissions?`. Save synthetic, non-private reports under `out/` (ignored), not in durable agent memory.

**Proposed 9/10 qualification:** 9/10 tasks resolve a correct entrypoint within three searches; five representative calls/import-to-test paths verified; median model tokens fall at least 20% on paired tasks **without loss of correctness or excessive wall-time increase**. If a symbol is ambiguous, require `--file`; if the checker cannot resolve dynamic calls, explicitly mark unknown.

```bash
node tools/agent-index.mjs find GrassCells --limit 5 --json
node tools/agent-index.mjs impact src/world/grassCells.ts --limit 8 --json
node tools/handoff-check.mjs --json
npm run check:quiet -- --no-visual
```

For an output-size *proxy only*, compare the UTF-8 bytes from equivalent `rg -n` and CLI result captures, but never report byte ratio as a measured model Token reduction. This benchmark is a task plan, not a claim that ten paired Agent runs have already been executed.
