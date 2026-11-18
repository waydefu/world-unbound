# ADR-0003 — GPU height texture and CDLOD for terrain rendering

- Status: accepted (owner: "可以", 2026-11-18)
- Date: 2026-11-18
- Owner: @waydefu

## Context

Terrain is rendered as one CPU-built mesh per 64 m chunk (LOD 0–4 with skirts), built in a worker, uploaded per chunk and drawn from render bundles (ADR-0002 §10). With the real 4 km Hellesylt world this produced 1296 resident chunks and a geometry-bound phone (G1.4.1 cut the ring to 491 chunks to reach 60 FPS). Remaining costs: per-chunk CPU builds and uploads, skirts, LOD popping, a separate far-terrain skin, bundles that cannot be frustum culled, and no cheap way for vegetation (G2) to find the ground on the GPU.

## Options considered

1. **Keep CPU chunks**, add geomorphing and culling: the cost of per-chunk geometry stays; bundles and culling remain at odds.
2. **Geometry clipmaps** (Losasso & Hoppe 2004): nested rings around the camera with toroidal updates. Best for unbounded, streamed worlds; coarse culling; more complex ring stitching.
3. **CDLOD** (Strugar 2010): one height texture, a quadtree of nodes selected per frame by distance ranges, every node drawn with the same grid patch (instanced), vertices displaced in the vertex shader and morphed continuously to the parent LOD near range boundaries.

## Decision

Option 3. The world is a bounded 4 km square that fits one 2048² height texture, so CDLOD covers the whole world (the far-terrain skin goes away), culls per node, needs no skirts and gives grass the same height texture. CPU height data (`src/world/heightField.ts`) stays the authority for gameplay, physics and queries; the GPU texture is a derived, read-only copy.

## Consequences

- GPU memory: height texture (R32F, 2048², 16 MiB) plus a material/AO texture (RGBA8, 16 MiB; 4 MiB at 4 m on the low tier).
- Vertex shader cost rises (texture loads per vertex); CPU per frame falls (node selection only, a few hundred nodes).
- Terrain draw calls become one instanced draw per LOD (≤ 6), so render bundles are no longer needed for terrain.
- The chunk path stays behind `?terrain=chunks` for one release for A/B and rollback, then is removed.
- Telemetry changes from chunks to nodes; the spike benchmark keeps its own chunk scene.

## Verification and rollback

Phone (owner, med tier): cams 0–5 at 60 FPS and render scale 1.0 for 60 s; blind visual review shows no regressions and no LOD seams or popping. Unit tests for node selection (coverage without gaps or overlaps, morph ranges). Rollback: `?terrain=chunks`, then a revert.
