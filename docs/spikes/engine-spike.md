# Engine spike: three.js vs Babylon.js (ADR-0002 §8)

Status: **round 1 done on the owner's phone; round 2 (three-bundle) pending.**

## Question

Should the renderer stay on three.js (WebGPURenderer) or move to Babylon.js before significant renderer code exists? The main open point is per-frame CPU submission cost at 400+ draws on a phone, where Babylon's snapshot rendering (WebGPU render bundles) could help.

## Method

Page: `/world-unbound/spike/engines.html` (not linked from the game).

- The same scene for every engine: about 1,000 terrain chunks and 156k triangles from the authoritative world core, LODs fixed per chunk, one PBR material with vertex colours, one directional and one hemisphere light, linear fog, no shadows, no tone mapping, 4× MSAA.
- The same camera path: an orbit driven by frame index, so every engine renders the same views.
- The same drawing-buffer size: the medium tier's pixel budget (2.2 MP).
- 5 s warm-up, then 20 s measured. Recorded: frame interval, CPU submission time (wall time of the engine's render call), GPU time where `timestamp-query` exists, draw calls, long frames, and any cross-origin request.

| Mode | What it is |
| --- | --- |
| `three` | three.js r187, per-frame frustum culling |
| `babylon` | Babylon.js 9.33.2, per-frame frustum culling, frozen material and world matrices |
| `babylon-snapshot` | Babylon.js with snapshot rendering (fast mode): draws recorded once as render bundles and replayed. No re-culling, so all chunks are drawn every frame — less CPU, more GPU work. WebGPU only |
| `three-bundle` (round 2) | three.js with every chunk in a `BundleGroup` (WebGPU render bundles), frustum culling off so all chunks are recorded — the same conditions as `babylon-snapshot`. WebGPU only |

## How to run (owner's phone)

1. Unplug the phone, same brightness, close other apps.
2. Open the page, run `three`, `babylon`, `babylon-snapshot`, then `three` again to check for thermal drift. Wait about a minute between runs.
3. The menu shows a table of all runs; tap **Export all (JSON)** and send the file.

An iPhone run, if available, is the most valuable extra data point.

## Known asymmetries

- GPU time scope differs: three.js reports all render passes, Babylon only the main pass. Compare GPU numbers within an engine across runs more than across engines.
- Babylon gets two standard optimisations (frozen material, frozen world matrices) that an optimised Babylon app would use; three.js has no direct equivalent.
- Background colour handling differs (three.js converts it to the output colour space); this does not affect cost.
- `engineInitMs` is not comparable: Babylon uploads geometry while meshes are created, three.js on the first rendered frame (inside the warm-up).
- Headless CI uses a software GPU: it only proves both engines run and fetch nothing cross-origin. Its timings are noise.

## Decision rule (set before seeing results)

Move to Babylon.js only if its better mode, on the owner's phone:

1. lowers CPU submission p95 by at least 30 % against three.js, **and**
2. does not raise frame-interval p95 or GPU time p95 by more than 10 %, **and**
3. the repeated `three` run shows no thermal drift large enough to explain the difference.

Otherwise keep three.js; if render bundles clearly help, look at render-bundle use within three.js in G1.

## Results

### Round 1 — 2026-11-17, owner's phone (Adreno 8xx, Chrome 157, WebGPU), 1073 × 2051 buffer (2.2 MP)

| Run | CPU p50 | CPU p95 | GPU p95 | Draws | Frame p95 | FPS |
| --- | --- | --- | --- | --- | --- | --- |
| three | 4.5 ms | 6.4 ms | ≈ 13 ms\* | 219 | 16.7 ms | 60.0 |
| babylon | 5.9 ms | 7.9 ms | 13.1 ms | 218 | 16.7 ms | 60.0 |
| babylon-snapshot | 0.4 ms | 1.1 ms | 13.4 ms | 998 | 16.7 ms | 60.0 |
| three (repeat) | 5.5 ms | 7.2 ms | ≈ 13 ms\* | 219 | 16.8 ms | 60.0 |

\* **Measurement bug, fixed for round 2.** three.js keeps one timestamp pair per render context and overwrites it every frame, so a resolve returns the latest frame's GPU time. The harness divided it by 30 and reported 0.35–0.44 ms; multiplied back, the values are about 10.5–13 ms, the same range as Babylon. Treat the three.js GPU column as an estimate.

Readings:

- CPU submission is the bottleneck to plan for: about 25 µs per draw call without bundles. Cascaded shadows, buildings and vegetation will multiply draws.
- Render bundles cut CPU submission by about 85 % while drawing 4.5× more chunks, with GPU time almost unchanged.
- Babylon without snapshots is slower on the CPU than three.js.
- The repeated three.js run is about 12 % slower on the CPU (thermal or clock drift), far smaller than the bundle effect.
- GPU time under a 60 Hz cap is inflated by mobile DVFS (the GPU clocks down to fill the frame), so it is not a headroom measure. A load test is needed for that.
- One cross-origin request (`fonts.gstatic.com`) came from Chrome's translate prompt, not from the page; round 2 marks the page `translate="no"`.

Decision status: Babylon's snapshot mode clears the CPU criterion by a wide margin, but the rule cannot be applied yet. The three.js GPU figures were wrong, and the follow-up this document already named — render bundles inside three.js — was not measured. Round 2 adds `three-bundle`.

### Round 2

Pending. Order: three, three-bundle, babylon-snapshot, three.
