# ADR-0001 — Engine architecture and repository layout

- Status: accepted (owner authorised direct adoption in the agent session of 2026-11-17)
- Date: 2026-11-17
- Owner: @waydefu
- Sources: game specification v1.0 ("Sankt Aldric Harbour"), AEGIS ∞ v2.0

## Context

The game specification asks for an architecture decision before any game code, and it disagreed with the governance baseline on five points: source layout, the Pages release workflow, milestone names, when WebGPU may be used, and the unfinished governance M0.

## Decision

1. **Renderer: three.js `WebGPURenderer` with TSL, automatic WebGL2 backend.** One material/shader code base serves both backends. A hand-written WGSL renderer would need a second GLSL renderer for the mandatory fallback, which a single maintainer cannot sustain.
2. **World core: pure TypeScript, data-oriented.** Typed arrays, integer-quantised heights, no three.js and no DOM in `src/world` or `src/perf`. Rust/Wasm stays out until profiling shows a CPU hot spot above 3.5 ms p95 that TypeScript cannot fix, and then only without threads (GitHub Pages cannot send COOP/COEP).
3. **Layout: a single Vite application under `src/`**, not the `apps/` + `packages/` monorepo sketched in AEGIS chapter 4 (which is a target shape, not a requirement to create folders).

   | Path | Responsibility | May import |
   | --- | --- | --- |
   | `src/world` | deterministic terrain, chunk grid, streaming table, mesh data | itself only |
   | `src/perf` | dynamic resolution, frame statistics, memory accounting | itself only |
   | `src/platform` | capability detection, session flag | DOM |
   | `src/render` | three.js renderer, GPU resources, environment | world, perf, app types |
   | `src/ui` | DOM HUD | app |
   | `src/app` | orchestration, frame loop, worker client, debug parameters | all of the above |

   `governance/owners.yml` now maps these paths. The boundaries are enforced by `scripts/audit.mjs`.
4. **Threads:** terrain tiles and meshes are built in a Worker with a main-thread fallback. Rendering stays on the main thread; a render Worker is deferred until WebGPU-in-Worker is stable on Safari.
5. **Milestones:** governance keeps M0–M4; game milestones are **G0–G3** (the specification's "Milestone 0–3").
6. **WebGPU from day one:** `AGENTS.md` now states that WebGPU is the primary backend with WebGL2 as a required, flagged fallback; hand-written WGSL and Rust/Wasm still need profiling and device evidence.
7. **Release:** `.github/workflows/pages.yml` builds, re-verifies and deploys `dist/` from main through the `github-pages` environment and OIDC. The owner must enable Pages (source: GitHub Actions) for it to succeed.

## Consequences

- **Reduced control versus the specification, section 3.3.** three.js owns pass scheduling and attachment setup. An explicit Render Graph with per-pass `loadOp`/`storeOp`, `TRANSIENT_ATTACHMENT` handling and a central pipeline registry can only be built where three.js exposes the hooks. Those items are best-effort, to be revisited when post-processing passes arrive in G1.
- three.js allocates internally during `render()`. The zero-allocation rule is enforced for project code only (functions tagged `@hot`).
- One draw call per terrain chunk (about 140–200 visible at the low tier). Merging far rings is a known follow-up if device profiling shows draw-call cost.
- The dynamic-resolution thresholds are ratios of the measured refresh period, not the literal 21.5 ms / 16.5 ms: a vsynced 60 Hz page never averages below 16.67 ms, so a fixed "< 16.5 ms" recovery rule would never fire. At 60 Hz the defaults are 21.5 ms down and 17.2 ms up.
- Terrain authority is the quantised lattice (`heightField.ts`); LOD 0 render vertices are bit-identical to it, which is how the 2 cm render/collision tolerance is met.

## Verification and rollback

- `npm run check`: typecheck, unit tests, production build, static audit, six-camera headless sweep with resilience checks., run in CI as `app-checks` and `visual-audit` behind `final-gate`.
- Not verified here: any real device. Frame rate, thermals, memory and WebGPU rendering on POCO F8 Ultra, iPhone Safari and desktop GPUs need the owner's hardware; the headless environment used for development cannot create WebGPU pipelines at all, so only the WebGL2 path and the WebGPU-to-WebGL2 fallback were exercised.
- Rollback: revert the introducing PR. No saved player data exists yet. `TERRAIN_VERSION` must be bumped whenever terrain shape or quantisation changes.
