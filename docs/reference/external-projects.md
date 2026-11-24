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

## Abyssal Garden 原始碼補充研究（2026-11-24）

- [main.js](https://github.com/Noniv/abyssal-garden/blob/main/source/src/main.js#L398)：CPU 先檢查分格 AABB 的視錐、距離，合併相鄰實例範圍並近列優先。大葉採 18/10/6 頂點的 triangle-strip，遠處另有稀疏實例表。不是逐葉 GPU compute 剔除。
- [shaders.js](https://github.com/Noniv/abyssal-garden/blob/main/source/src/shaders.js#L401)：參數化葉片曲線、法線、擺動、雙面光照、透光；使用真實幾何輪廓而非植物透明矩形。適合作為中景代理實驗，而非替換已核准草模。
- [main.js](https://github.com/Noniv/abyssal-garden/blob/main/source/src/main.js#L145)：GPU 生成密度場後讀回 CPU，Surface Nets 在 CPU 生成地形網格；陰影主要為載入期預計算。真實 4 km 地形與動態日夜仍應維持本專案 CDLOD 及 CSM。
- 本專案下一步見 [不透明程序化草片對照](../specs/s1-turf-lighting-diagnostics.md#不透明程序化草片對照abyssal-garden-研究)。保留 Three.js TSL 和 WebGL2；先量測再選底層重構，不採用上游程式碼。
