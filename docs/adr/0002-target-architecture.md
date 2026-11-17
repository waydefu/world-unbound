# ADR-0002 — Target architecture: platform tiers, build-time generation, art direction

- Status: proposed — the owner confirms or amends the four decisions marked **(owner)** on the pull request
- Date: 2026-11-17
- Owner: @waydefu
- Supersedes: parts of ADR-0001 (WebGL2 role, three.js limitations, terrain source)
- Sources: game specification v1.0 incl. research chapters 08–21; AEGIS ∞ v2.0; G0 device report (Adreno 8xx, Chrome 157, WebGPU, 60 Hz locked)

## Context

The specification now carries a research supplement (chapters 08–21) aiming at UE5-like visual quality. Read against chapters 01–07, three conflicts appear that get more expensive the later they are settled:

1. A mandatory WebGL2 fallback versus GPU-driven techniques. WebGL2 has no compute shaders, storage buffers or indirect draws, which almost every technique in chapters 09–17 relies on.
2. Sustained 60 FPS for 20 minutes on a phone versus UE5-class effects. That is a power and thermal limit, not a code-quality question.
3. "Purely procedural, at runtime" versus quality and load time. Erosion, a 400-building grammar, tree growth and material synthesis are slow and power-hungry on a phone and hard to keep deterministic.

ADR-0001 also overstated three.js limitations. Checked in the r187 sources (presence only, not device-tested): TSL compute, storage and indirect-draw buffers, atomics, subgroups, 3D storage textures, `trackTimestamp`, automatic `storeOp: discard`, transient-attachment detection, MRT, and ready-made TRAA/TAAU, SSGI, SSR, GTAO, SSS, Bloom, FSR1, CSM, SkyMesh, WaterMesh and BatchedMesh nodes.

## Decision

### 1. Specification precedence

Chapters 01–07 are normative. Chapters 08–21 are a candidate-technique backlog. A technique is adopted only through an ADR that cites chapter-20-style evidence (fixed cameras, fixed seeds, device timings). "Not bound by chapters 01–07" in chapter 08 applies to research, not to shipped code.

### 2. Platform tiers **(owner)**

| Tier | Backend | Ceiling |
| --- | --- | --- |
| Full / Desktop | WebGPU | Chases the chapter-20 reference; optional SSGI, volumetric clouds, higher shadow and history resolution |
| Full / Phone | WebGPU | Stable 60 FPS for 20 minutes first; curated effects only; quality scales down before frame rate does |
| Lite | WebGL2 | Baked lighting, no GPU-driven features, clearly flagged in the HUD |

Optional GPU features (`subgroups`, `shader-f16`, `timestamp-query`, `atomic-vec2u-min-max`, ...) are capability flags, never prerequisites. iOS Safari support is unverified and is a required test target before any feature becomes default.

### 3. Build-time generation, runtime streaming **(owner)**

Generators remain code ("pure program"), but the heavy ones run at build time and ship as versioned, compressed data within the 150 MB budget, as specification §2.2 and §3.1 already allow.

```
recipes (versioned, in Git)
   │  tools/bake  (Rust, cargo --locked, pinned toolchain)
   ▼
baked content: height tiles, building meshes + LOD/HLOD, tree meshes + impostors,
               KTX2 material sets, SH probe sets
   │  content manifest: path, SHA-256, recipe version, seed
   ▼
runtime streaming worker → decode → world core (authority) + renderer
```

- Rust for heavy bake tools (erosion, building grammar meshing, tree growth). C++ only through existing libraries with Rust or JS bindings (meshoptimizer, Basis Universal). No Python in the product path.
- The bake is deterministic: the same recipes and seed produce byte-identical output, and CI checks this by baking twice.
- Baked output is not committed. It is regenerated in CI each build; a trusted cache may be introduced only under AEGIS A01 if bake time becomes a problem.
- Runtime procedural work is kept for what is cheap or time-varying: sky LUTs, waves, wind, wetness, foam, seasons.
- Terrain authority stays the quantised lattice, now read from baked tiles. Height queries return `Pending` / `Unavailable` / `OutOfWorld` instead of a silent value (specification §18.2).

### 4. Runtime structure

```
main thread     input (timestamped, late-latched) · HUD · render submission
sim worker      world core (SoA), physics, NPC, farming, saves → publishes snapshots
stream worker   fetch, verify digest, decode (meshopt / KTX2), hand off buffers
GPU             three.js WebGPURenderer behind our RenderBackend interface;
                custom WebGPU passes plugged in only where three.js cannot do the job
```

- No `SharedArrayBuffer`; workers exchange transferable buffers.
- One `EnvironmentSnapshot` (epoch, simulation time, sun and moon, season, wind, precipitation, wetness, wave spectrum, sea level) per frame, read by every visual and gameplay system (specification §18.1).
- The renderer stays on the main thread. A render worker is revisited only after iOS WebGPU-in-worker stability is shown on a device.

### 5. Art direction **(owner)**

Physically based light, sky, atmosphere and weather; materials and shapes deliberately curated rather than photo-scanned: a researched Hanseatic palette for brick, tile, timber and plaster, consistent weathering rules, and readable silhouettes. Full procedural photorealism on a phone browser is the hardest possible combination and the most prone to uncanny results, so it is not the goal.

### 6. Technique priorities for chapters 08–21

| Priority | Chapters | Start with |
| --- | --- | --- |
| Now | 18 contracts, 19 diagnostics | EnvironmentSnapshot, query result types, per-pass GPU time, hitch classes |
| High | 13 sky, 11 shadows, 17 HDR/TAA, 12 materials, 14 ocean, 16 vegetation | Atmosphere LUTs, CSM + contact shadows, exposure + TRAA, baked KTX2 materials, banded waves, baked trees |
| Medium | 10 indirect light | Baked SH probes relit by the sun; SSGI on desktop only |
| Deferred | 09 Nanite-like clusters, VSM pages, dynamic Lumen-like GI | meshoptimizer LOD + HLOD + instancing until silhouette tests fail |

### 7. Reference and acceptance **(owner)**

Chapter 20's method, without requiring Unreal reference scenes up front: reference boards from real Hanseatic towns, fixed cameras and seeds, device timing reports, and blind review. Unreal reference renders remain optional later.

Measurable goal replacing "best everywhere": on a phone browser, ≤ 150 MB download, 60 FPS sustained for 20 minutes without thermal step-down, and the six fixed cameras judged better in blind review than comparable web 3D work.

### 8. Revised milestones

- **G0.5:** bake pipeline with eroded terrain; EnvironmentSnapshot and query contracts; simulation and streaming worker skeletons; telemetry fixes (per-pass GPU time, measured pipeline count, soak mode, load bytes and cache hits).
- **G1:** sky and atmosphere, shadows, HDR / exposure / TRAA, ocean v1, baked terrain materials.
- **G2:** baked buildings and vegetation, baked SH probes.
- **G3:** gameplay loop, procedural audio, saves.

## Consequences

- WebGL2 users get a visibly lower tier instead of a broken or slow Full tier.
- CI gains a Rust toolchain, a determinism check and content-manifest digests. These touch `.github/workflows/` and need owner authorisation when implemented; `Cargo.lock` and `build.rs` are already sensitive paths.
- Load-time decoding replaces runtime generation, so first-load bytes and cache behaviour must be measured (specification §3.1).
- Known G0 telemetry gaps to fix in G0.5: the shader-variant count is a hard-coded constant, not a measurement; the memory registry only tracks terrain; first-load bytes and cache hits are not recorded.

## Verification and rollback

- Each milestone ends with the six-camera sweep in CI plus a device report from the owner's phone; an iPhone report before any Full-tier feature becomes default.
- Rollback: this ADR changes direction, not shipped behaviour. G0 keeps working until G0.5 replaces the formula terrain with baked tiles behind the same authority interface.
