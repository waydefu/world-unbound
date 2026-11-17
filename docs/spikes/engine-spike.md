# Engine spike: three.js vs Babylon.js (ADR-0002 §8)

Status: **tooling ready, device results pending.**

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

Pending the owner's device report.
