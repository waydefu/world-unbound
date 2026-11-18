# External reference projects

Projects the owner pointed to as references. Links only: no code is copied into this repository. If code is ever reused, its licence notice must come with it.

## Abyssal Garden

- Repository: https://github.com/Noniv/abyssal-garden (reviewed at commit `a596354`, 2026-11-14)
- Licence: MIT (Copyright (c) 2026 Maksymilian Dendura)
- What it is: a procedural underwater scene in one ~96 KB HTML file. Raw WebGPU and WGSL, no engine, no texture or model files, synthesized audio. Its README reports ~180 fps at 2560×1440 on an RTX 5070 Ti and ~20 fps at 670×372 on Low on a Samsung Galaxy A16.

### What is relevant to WORLD UNBOUND

| Idea | Where it applies here |
| --- | --- |
| **Blind visual critic**: a separate agent sees only renders from 6 fixed camera poses plus a fly-through recording (never the code), returns prioritised defects, and the work iterates until nothing above "minor" remains (`prompt.txt`) | Matches ADR-0002 §7 (blind review). Our six fixed test cameras and the visual audit already exist; adding a render-only critic subagent to each G-step is cheap and catches what pixel statistics miss |
| **Scripted fly-through benchmark** with GPU timestamps, reporting average / p99 / max frame and GPU time (`dev.js`) | Our telemetry measures fixed cameras only; a scripted camera path would expose streaming hitches, shimmer and popping |
| **Adaptive quality order**: lower resolution first, then draw distance, in small steps; the settled values are remembered per device; a crash restarts one level lower | We have dynamic resolution and crash recovery; draw-distance stepping and remembering settled values are not implemented |
| **GPU-side world generation at load** and ~2 million instanced kelp leaves | Reference for G2 vegetation (instancing, density per tier: High full, Medium half, Low a quarter) |
| **Zero per-frame JS allocation** as a hard rule | Same rule as our `@hot` audit |

### Where it differs (do not copy blindly)

- WebGPU only, no WebGL2 path; ADR-0002 requires a flagged WebGL2 Lite tier.
- Desktop RTX target; the phone figure above shows how far a mobile GPU falls behind with this approach.
- A bounded art scene: no streaming world, gameplay, saves, determinism or governance.
- Hand-written WGSL and a custom renderer; ADR-0001/0002 keep three.js + TSL and allow hand-written WGSL only where profiling justifies it.

## Grass and foliage references (for G2)

Looked at 2026-11-17 from page source and marketing text only (not run; no performance verified).

| Project | What it is | Licence | Ideas for G2 |
| --- | --- | --- | --- |
| Duskward (https://agnt.gg/creation?id=DmDSpPYm) | Single-file raw WebGPU/WGSL world by a user of the AGNT platform; instanced terrain, trees, grass, water, birds; packed vertex formats; desktop only per the page | None stated: learn only | Per-instance variation from a hash of the instance index, nothing stored per blade |
| Three.js Grassworks (https://grassworks.techredux.co/forest-demo) | Commercial three.js WebGPURenderer + TSL grass system (Tech Redux): instanced blades, distance/frustum culling, LODs, billboard mode, wind, terrain-aware placement, camera-recentred grid | All rights reserved; paid licence: do not copy code | Camera-centred cell grid; blades near, cards mid-distance, nothing far, density fading with distance; density as a quality setting (WebGL2 Lite: hash placement in the vertex stage, lower density) |

## Sky and clouds reference (for the weather step)

- [takustaqu/atmosphere](https://github.com/takustaqu/atmosphere) (MIT). Procedural sky in one WebGL1 fragment shader (raw GLSL, no three.js dependency): the ten cloud genera reduced to four forms at three altitudes, cumulonimbus optionally ray-marched as a volume, value noise baked to a small tiling texture, clouds rendered at a fraction of resolution (`cloudScale`), an experimental keyframed sky cache, screen-space crepuscular rays, precipitation and optics. Desktop timings only (M2 Max 5.3 ms at 1080p); no mobile data.
- Relevant: the genus-to-form-and-altitude reduction, reduced-resolution clouds, the baked tiling noise (as in our G1.4.1 noise texture), crepuscular rays.
- Differs: its sky colour is hand-tuned and a function of elevation, not physical; ours is Hillaire (ADR-0002) and must stay the light source for clouds. Read from the README only; `src/` not reviewed yet.
