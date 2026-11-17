# Engine spike: three.js vs Babylon.js (ADR-0002 §8)

Status: **closed 2026-11-17 — stay on three.js; render bundles are mandatory for static geometry** (ADR-0002 §10).

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

### Round 2 and confirmation — 2026-11-17, same phone and buffer, GPU timing fixed

All runs 60 FPS, zero long frames, frame-interval p95 16.7–16.8 ms. GPU p95 is 12.8–13.4 ms in every mode.

| Time (UTC) | Mode | CPU p50 | CPU p95 | GPU p95 |
| --- | --- | --- | --- | --- |
| 07:25 | three | 5.2 ms | 7.0 ms | 12.9 ms |
| 07:25 | three-bundle | 1.5 ms | 2.3 ms | 13.2 ms |
| 07:26 | babylon | 6.3 ms | 7.9 ms | 12.8 ms |
| 07:26 | babylon-snapshot | 0.4 ms | 1.0 ms | 13.4 ms |
| 07:34 | three | 5.4 ms | 7.3 ms | 13.0 ms |
| 07:35 | three-bundle | 1.3 ms | 2.2 ms | 13.0 ms |
| 07:35 | babylon | 5.7 ms | 7.4 ms | 13.0 ms |
| 07:36 | babylon-snapshot | 0.4 ms | 1.1 ms | 13.2 ms |
| 07:36 | three-bundle | 0.9 ms | 1.6 ms | 13.0 ms |
| 07:37 | babylon-snapshot | 0.4 ms | 1.3 ms | 13.0 ms |
| 07:38 | babylon | 4.1 ms | 7.6 ms | 12.9 ms |

### Decision

The rule compares the better mode of each engine (bundles on both sides, the stricter reading; the rule was written before `three-bundle` existed). Before the confirmation runs, the owner was told a switch needs Babylon to win **both** alternating pairs by at least 30 % on CPU p95.

| Pair | three-bundle | babylon-snapshot | Difference | ≥ 30 % |
| --- | --- | --- | --- | --- |
| Round 2 | 2.3 ms | 1.0 ms | −57 % | yes |
| Confirmation 1 | 2.2 ms | 1.1 ms | −50 % | yes |
| Confirmation 2 | 1.6 ms | 1.3 ms | −19 % | **no** |

Thermal drift: three without bundles moved 7.0 → 7.3 ms (+4 %). GPU and frame interval show no difference.

**Outcome: the criterion is not met consistently, so the renderer stays on three.js.** Stated plainly: Babylon's snapshot mode was lower in every pair (mean CPU p95 1.1 vs 2.0 ms; p50 0.4 vs 0.9–1.5 ms). The absolute gap is under 1 ms (about 6 % of a 16.7 ms frame), and `three-bundle` itself varied between 1.6 and 2.3 ms. That gap does not justify rewriting the render layer or giving up TSL.

### What the spike settled regardless of engine

1. Without render bundles, CPU submission costs about 25 µs per draw and becomes the bottleneck once shadows, buildings and vegetation multiply draws. **Static geometry goes into `BundleGroup`.**
2. With bundles, CPU submission drops from about 7 ms to 1.6–2.3 ms while drawing 4.5× more chunks.
3. Per-frame frustum culling saved no measurable GPU time in this scene.
4. GPU time is 11–13 ms per frame at 2.2 MP with 4× MSAA, but a 60 Hz cap lets mobile DVFS stretch it. Before G1 adds effects, a load test must measure real headroom.

Open questions not covered here: iPhone Safari; chunk streaming invalidates bundles (re-recording cost); dynamic objects stay outside bundles.
