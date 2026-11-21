# Visual review (blind critic)

Adopted 2026-11-17 by the owner ("盲審加進流程"). Idea from Abyssal Garden (see `docs/reference/external-projects.md`); implements the blind review of ADR-0002 §7.

## When

Every PR that changes what the game looks like (rendering, materials, terrain, sky, water, lighting, cameras). Not for docs, governance or pure logic changes.

## How

### Real-world reference

- Define the visual target with photos, footage, or measured specimens of the actual object. Record its scale, usable viewpoints, lighting and material cues. Game and mod examples can inform technique. Score realism against the real-world reference.
- For a new asset or a substantial visual change, start with an isolated, real-scale sample. Show the reference and high-quality model together before deriving runtime geometry, textures and LODs from the approved sample. For grass, include the leaf and roots, standing turf coverage, an elevated view and backlighting. Review static density separately from wind behaviour.
- When the owner asks to use the approved master directly, first render its complete geometry and authored attributes in the game. Capture it at the master’s scale and camera angles, and record the differences in lighting and materials. Keep that runtime capture as the benchmark for evaluating any later optimization.
- Capture the runtime result at the same scale, camera, light and wind settings as the approved model wherever practical. Label references with unmatched shooting conditions and list visible losses. Keep image preference, realism relative to photos, and device frame time as separate results.

### Worldwide turf acceptance

For changes to grass across the world, apply the [approved worldwide turf standard](../specs/s1-rooted-soil.md#全域草毯驗收). Use the complete one-square-metre master at **79,524 leaves/m²** as the density and close-up reference. Assess grass in normal gameplay at multiple locations, from root level through standing and elevated views, and during movement across detail and streaming boundaries.

A visible ring of dense blades, bare-looking flat green beyond it, a sharp density drop or a streaming seam is a blocker for worldwide acceptance. Treat a single master capture, the reported target density, and automated checks as supporting evidence. Record the actual gameplay comparison and the owner's visual result before declaring worldwide turf accepted. Record device frame times separately and verify any optimization against the same reference views.

### Runtime review

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
