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
