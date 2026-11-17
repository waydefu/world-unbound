# Repository index

Where everything is. Start with [HANDOFF.md](HANDOFF.md) to pick up the work.

## Read first

| Document | What it is |
| --- | --- |
| [HANDOFF.md](HANDOFF.md) | Current state, open work, how to resume, owner actions |
| [AGENTS.md](../AGENTS.md) | Contract for AI coding agents (protected) |
| [README.md](../README.md) | Status, how to run, roadmap |
| [architecture/README.md](architecture/README.md) | Module layers (enforced), frame and data flow, units |

## Decisions and plans

| Document | What it is |
| --- | --- |
| [adr/0001-engine-architecture.md](adr/0001-engine-architecture.md) | TypeScript + three.js WebGPURenderer/TSL, WebGL2 fallback |
| [adr/0002-target-architecture.md](adr/0002-target-architecture.md) | Platform tiers, build-time bake, art direction, acceptance, revised milestones, render bundles (§10) |
| [adr/0000-template.md](adr/0000-template.md) | ADR template |
| [rfc/README.md](rfc/README.md) | RFC process |
| [spikes/engine-spike.md](spikes/engine-spike.md) | three.js vs Babylon on the owner's phone; why bundles are mandatory |
| [spikes/terrain-erosion.md](spikes/terrain-erosion.md) | Erosion prototype findings; why the bake was deferred |
| [reference/engine-research-v1.1.md](reference/engine-research-v1.1.md) | Engine architecture research and technical decisions v1.1 (owner's source document; research proposal) |
| [reference/external-projects.md](reference/external-projects.md) | External reference projects (Abyssal Garden: blind visual critic, fly-through benchmark, adaptive quality) |
| [reference/game-spec-v1.md](reference/game-spec-v1.md) | Game specification v1.0 (owner's source document) |
| [reference/aegis-v2.md](reference/aegis-v2.md) | AEGIS ∞ v2.0 governance specification (owner's source document) |
| [process/visual-review.md](process/visual-review.md) | Blind visual critic step for every visual PR (`wu-critic` subagent) |

## Governance and security

| Document | What it is |
| --- | --- |
| [governance/status.md](governance/status.md) | Governance status across milestones, decision log, owner authorisations, open gaps |
| [governance/m1.md](governance/m1.md) | M1 trusted quality gate: controls, platform limits, acceptance matrix |
| [ci-trust-boundary.md](ci-trust-boundary.md) | What CI is trusted for and what it is not |
| [threat-model/README.md](threat-model/README.md) | Threat model |
| [runbooks/break-glass.md](runbooks/break-glass.md) | Emergency ruleset changes |
| [release-policy/README.md](release-policy/README.md) | Release policy |
| [../governance/](../governance/) | Machine-readable policy: owners, labels, risk, sensitive paths, exceptions, asset and release policy (protected) |
| [../SECURITY.md](../SECURITY.md) · [../CONTRIBUTING.md](../CONTRIBUTING.md) · [../CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md) | Community files |

## Contracts

| Document | What it is |
| --- | --- |
| [contracts/system-invariants.md](contracts/system-invariants.md) | Runtime invariants (proposed) |
| [contracts/save-schema.md](contracts/save-schema.md) | Save format contract (R2 sensitive path) |
| [../assets/manifests/README.md](../assets/manifests/README.md) | Asset manifests |

## Code

| Path | What it is |
| --- | --- |
| `src/world/` | Deterministic terrain core (pure) |
| `src/perf/` | Frame stats, dynamic resolution, memory budgets (pure) |
| `src/env/` | Calendar, ephemeris, atmosphere, weather (pure) |
| `src/platform/` | Capability probe, crash-recovery session |
| `src/render/` | Renderer, terrain meshes, sky, environment lighting, shadows |
| `src/ui/` | HUD |
| `src/app/` | App and frame loop, streaming, environment clock, params, quality tiers, telemetry |
| `spike/` | Engine comparison and GPU load ramp (`/world-unbound/spike/engines.html`) |
| `tests/` | Vitest suites: `world`, `streaming`, `perf` (incl. params/quality), `env` |
| `scripts/audit.mjs` | Static audit: module layers, purity, `@hot`/`@amortized`, size budgets |
| `scripts/audit-visual.mjs` | Headless render sweep of six cameras, resilience and spike smoke |
| `.github/workflows/` | CI (`ci.yml`), Pages deploy, label sync (protected) |
| `.github/scripts/` | Governance validators and their tests (protected) |

## URL parameters (main page)

`?cam=0..5` camera · `backend=webgpu|webgl2` · `q=low|med|high` quality · `scale=0.5..1.5` pinned render scale · `hour=0..24` · `day=0..32` (0 spring equinox, 8 summer solstice; default 6) · `wx=clear|cloudy|rain|storm` · `shadows=0` · `hud=0`.

## Test cameras

| # | Name | Purpose |
| --- | --- | --- |
| 0 | coast-low | Beach and waterline at eye height |
| 1 | architecture-detail | Town plateau close-up (no buildings yet) |
| 2 | vegetation-near | Grass slopes (no vegetation yet) |
| 3 | backlit-dusk-water | Low sun over water, 19.6 h |
| 4 | rain-night | Rain at 22.5 h |
| 5 | town-harbour-overview | Default; harbour from 170 m |

## Telemetry (JSON export, schema in `src/app/report.ts`)

Frame percentiles and refresh rate, dynamic resolution, memory partitions, shader warm-up and first-frame times, world readiness and streaming counters, draw calls/triangles, environment (day, season, hour, weather, sun altitude, moon illumination, exposure, atmosphere build time), capabilities.
