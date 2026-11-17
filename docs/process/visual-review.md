# Visual review (blind critic)

Adopted 2026-11-17 by the owner ("盲審加進流程"). Idea from Abyssal Garden (see `docs/reference/external-projects.md`); implements the blind review of ADR-0002 §7.

## When

Every PR that changes what the game looks like (rendering, materials, terrain, sky, water, lighting, cameras). Not for docs, governance or pure logic changes.

## How

1. After the visual audit passes, render the six test cameras at 1280×720 with the HUD off (`?cam=N&hud=0&q=high&scale=1`, WebGL2 in the container) plus any extra views the change targets (e.g. `wx=storm`, a dusk hour). Name files `<cam>-<name>-<hour>-<weather>.png` in one folder in the scratchpad.
2. Spawn the `wu-critic` subagent with **only** the image paths and, for each, the camera name, hour and weather. Never pass code, specs, diffs or the implementer's report.
3. Fix every **blocker** and **major** finding, or record in the PR why it is accepted for now (e.g. needs a later milestone). Re-render and re-run the critic until the verdict is PASS or every remaining item is explicitly deferred.
4. Put the critic's final table (verbatim) in the PR under "How was it tested?", with the deferred items listed under "What could break?".

## Limits

- The critic sees still frames from a software renderer (SwiftShader WebGL2), not the phone's WebGPU output, and no motion: shimmer, popping and frame pacing still need the owner's device runs and, later, a scripted fly-through.
- It is AI judgement, not owner approval; the owner's own look at the phone remains the acceptance.

## Performance gate

The GPU figure in telemetry is **not** a frame budget. three.js `WebGPUTimestampQueryPool.resolveQueriesAsync` returns the *sum of per-pass begin-to-end durations* of the last frame (3 shadow cascades + main + ...). On tiled mobile GPUs passes overlap and include waits, and the GPU down-clocks when lightly loaded, so the sum can exceed the frame interval (owner telemetry: sum p50 26.1 ms while frames held 60 FPS, p95 17.5 ms). It is reported as `frames.gpuPassSumP50Ms` / `gpuPassSumP95Ms` (HUD label `gpu Σpass`) with `frames.gpuPassesPerFrame`, for relative A/B comparison only.

Acceptance uses frame-interval evidence only. On the owner's phone, med tier, for each of cam 3 and cam 5: render scale stays 1.0 for 60 s at 60 FPS (no frame > 50 ms after warm-up), **and** the G1.0 load ramp on the spike page shows at least 30 % headroom. The orchestrator states the numbers in the PR. A 10-minute soak is run at the end of G1.
