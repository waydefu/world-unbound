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

### Environment production and acceptance

Apply the same workflow to terrain, rock, soil, vegetation, water, shorelines, built surfaces, atmosphere, lighting and weather. Each system has its own physical reference and a consistent quality standard across the places and conditions where it occurs.

1. **Reference the real thing.** Collect real photos, footage, scans or measurements at the relevant scale and under representative conditions. Record the location, scale, material response, behaviour and known assumptions. Use the real-world behaviour to choose what to measure on screen.
2. **Approve a full-quality master.** Build a real-scale high-detail asset, measured material or high-fidelity physical reference scene from those sources. Inspect it in game against the reference before deriving optimized geometry, textures or simulation. Keep the approved master and the in-game comparison for later reviews.
3. **Integrate across the applicable area.** Build the playable environment from that master and its physical data. Use the same quality standard at every applicable location, including near, distant and streamed areas. Inspect contact between adjacent systems, such as the wet line where shore meets water and the lighting response where rain wets soil and rock.
4. **Review normal gameplay.** Compare several representative locations and conditions at matched camera, lighting and weather settings. Include near, wide and elevated views as appropriate, plus motion across distance, streaming, or weather transitions. A showcase patch provides source-asset evidence. Acceptance requires the resulting environment to retain its defining shape, material, scale and behaviour across the playable scene.
5. **Verify optimizations against the master.** Use off-screen culling and streaming where applicable. Compare any change to visible detail against the same reference views. A visible quality ring, coverage hole, seam or abrupt change in motion blocks acceptance of that scope. Record visual findings and target-device frame times separately.

| System | Features to compare with the master |
| --- | --- |
| Terrain, rock, soil and built surfaces | Landform and object scale, material grain and relief, contact, weathering and wet response |
| Water and shorelines | Surface motion at real scale, depth and colour, reflections, shallows and water-to-land contact |
| Atmosphere, lighting and weather | Sun direction, sky and haze depth, shadows, weather movement and the scene's response over time |
| Vegetation | Species form, rooting, density, canopy thickness and wind response |

### Worldwide turf acceptance

For the grass application of this workflow, use the [approved worldwide turf standard](../specs/s1-rooted-soil.md#全域草毯驗收). Use the complete one-square-metre master at **79,524 leaves/m²** as the density and close-up reference. Assess grass in normal gameplay at multiple locations, from root level through standing and elevated views, and during movement across detail and streaming boundaries.

A visible ring of dense blades, bare-looking flat green beyond it, a sharp density drop or a streaming seam is a blocker for worldwide acceptance. Treat a single master capture, the reported target density, and automated checks as supporting evidence. Record the actual gameplay comparison and the owner's visual result before declaring worldwide turf accepted. Record device frame times separately and verify any optimization against the same reference views.

### Runtime review

1. After the visual audit passes, render the six test cameras at 1280×720 with the HUD off (`?cam=N&hud=0&q=high&scale=1`, WebGL2 in the container) plus any extra views the change targets (e.g. `wx=storm`, a dusk hour). Name files `<cam>-<name>-<hour>-<weather>.png` in one folder in the scratchpad.
2. Spawn the `wu-critic` subagent with **only** the image paths and, for each, the camera name, hour and weather. Never pass code, specs, diffs or the implementer's report.
3. Fix every **blocker** and **major** finding, or document the deferral in the PR. A deferred environment quality blocker keeps the affected scope pending acceptance. Re-render and re-run the critic until the verdict is PASS or every remaining item is explicitly deferred.
4. Put the critic's final table (verbatim) in the PR under "How was it tested?", with the deferred items listed under "What could break?".

## Limits

- The critic sees still frames from a software renderer (SwiftShader WebGL2), not the phone's WebGPU output, and no motion: shimmer, popping and frame pacing still need the owner's device runs and, later, a scripted fly-through.
- It is AI judgement, not owner approval; the owner's own look at the phone remains the acceptance.

## Performance gate

The GPU figure in telemetry is **not** a frame budget. three.js `WebGPUTimestampQueryPool.resolveQueriesAsync` returns the *sum of per-pass begin-to-end durations* of the last frame (3 shadow cascades + main + ...). On tiled mobile GPUs passes overlap and include waits, and the GPU down-clocks when lightly loaded, so the sum can exceed the frame interval (owner telemetry: sum p50 26.1 ms while frames held 60 FPS, p95 17.5 ms). It is reported as `frames.gpuPassSumP50Ms` / `gpuPassSumP95Ms` (HUD label `gpu Σpass`) with `frames.gpuPassesPerFrame`, for relative A/B comparison only.

Acceptance uses frame-interval evidence only. On the owner's phone, med tier, for each of cam 3 and cam 5: render scale stays 1.0 for 60 s at 60 FPS (no frame > 50 ms after warm-up), **and** the G1.0 load ramp on the spike page shows at least 30 % headroom. The orchestrator states the numbers in the PR. A 10-minute soak is run at the end of G1.
