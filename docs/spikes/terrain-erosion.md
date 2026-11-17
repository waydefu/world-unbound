# Spike: build-time terrain erosion (G0.5)

Status: **deferred 2026-11-17 by owner decision** — quality not yet good enough to justify the bake pipeline; G1 (light, materials, ocean) goes first.

## Question

Does build-time erosion (ADR-0002 §3) make the terrain clearly more convincing before we invest in the bake pipeline, CI toolchain and runtime streaming?

## Method

A throwaway Rust prototype (std only, single-threaded, fixed seed) read the current authoritative lattice (1025 × 1025 samples at 2 m, heights −25.4 … 44.9 m) plus a mask protecting the town plateau and harbour basin. Two variants: **A** current relief, **B** hills uplifted × 1.8 first. Judged on hillshade renders of the hill country south of the town. Not committed; the findings are what matter.

## Iterations

| # | Method | Result |
| --- | --- | --- |
| 1 | Particle hydraulic erosion (Beyer-style droplets) + thermal | Closed noise basins trap droplets; sediment fills them into flat round discs — crater-like, unnatural. No valley network. |
| 2 | Priority-flood depression filling, stream-power incision, droplets | Filled basins become large flat plains; incision has no slope to work with there. Worse. |
| 3 | Route flow over the filled surface but incise the real one (breaching), thermal, no droplet deposition | Drainage channels appear, but one cell (2 m) wide and grid-aligned (D8 streaks). Closer, still visibly synthetic. |

All variants were deterministic (repeat runs gave identical FNV-64 hashes) and took 3–8 s, so a CI bake is feasible.

## Findings

- The base terrain is value-noise fBm with many closed basins; it does not look water-shaped, and erosion is post-processing an unnatural start.
- Doing it properly needs a landscape-evolution approach: multiple-flow-direction routing (removes grid streaks), uplift plus stream-power over many steps (grows a dendritic network), and hillslope diffusion (smooths valley walls) — probably several research rounds.
- In this gentle moraine landscape (45 m relief) 2 m-scale channels are only visible up close; the larger visual gap today is light, materials and vegetation.
- Kettle lakes and bogs are historically plausible here. Filled basins could later become reed lakes or alder carr instead of being carved away, once water and vegetation exist.

## When to resume

After G1 lighting and materials, so terrain shape is judged under real shading. Start from iteration 3 with MFD routing and an uplift/diffusion loop; acceptance by fixed-camera before/after on the owner's phone.
