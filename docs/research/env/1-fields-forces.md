# Environment fields and the force-field layer

## Summary

- Repo state (fact): `src/env/weather.ts` has only the weather enum and a wetness constant. There is no wind anywhere; the ocean material just drifts "with the wind, +z". ADR-0002 mandates one `EnvironmentSnapshot` per frame and "runtime procedural for wind, wetness" (spec §18.1, §14.2 `computeWindField`).
- Recommendation: a small set of coarse, analytic-plus-baked fields owned by pure `src/env` on the sim side, uploaded as tiny textures for rendering. Do not build a general GPU fluid or a full world grid. Wind is the first field and gates G2 grass.
- Wind = (baked static terrain-channelling table x weather-driven global vector) + scrolling gust noise + per-material shader sway. Cost is well under 0.3 ms GPU and negligible CPU.
- Physics: keep our own fixed-tick kinematic/force layer (buoyancy, drag, sails) in `src/world`. Add Rapier (wasm) only for rigid bodies (debris, props, boats colliding) once needed, in the sim worker.
- Determinism: fixed 60 Hz sim tick, all fields are pure functions of (seed, sim time, weather state). Rendering-only gust detail may use frame time; gameplay reads only the tick-quantised version.

## Recommendations

| Item | Approach | Layer | Mobile cost (inference) | Roadmap |
|---|---|---|---|---|
| Field substrate | `EnvField` descriptor + CPU `Float32Array`/`Uint8` grids; GPU copy as small RGBA16F/RGBA8 textures via `DataTexture` | grids and sampling math in `env` (pure); texture upload in `render`; ownership in `app` | < 0.1 ms CPU/frame amortised, < 1 MB VRAM total | before G2 |
| Wind | Baked static "channel" map + analytic weather vector + scrolling gust noise; one 64x64 RGBA16F wind texture around the camera | env (maths), render (sampling TSL), app (upload) | ~0.05 ms GPU build, trivial sampling | **first, before grass (G2)** |
| Wetness / snow | Per-weather scalar in snapshot now; later a 128^2 toroidal wetness mask (slope/drainage), CPU-built in worker | env + render | negligible | with terrain materials / G3 |
| Light/shade | Do not make a field. Read cascaded shadow map and cloud shadow directly | render | 0 | n/a |
| Temp / humidity / pressure | Scalars in the snapshot plus an altitude lapse (height-based) function; no grids | env | 0 | when needed (audio, AI, snow line) |
| Forces | Own deterministic force layer (buoyancy via hull sample points on the Gerstner function, drag, sail/flag) | world (pure) | ~10-50 us per hull per tick | with first boat |
| Rigid bodies | Rapier wasm in the sim worker, only for debris and props | app/worker wrapper; not in pure layers | est. 2-4 ms/tick for ~200 active bodies on phone, to be measured | late, behind a spike |
| Vegetation push | Camera-local "interaction" texture (player, boat, NPC discs), additive decay | render; sources supplied by app | ~0.1 ms | G2.5, after grass wind |

## Details

### 1. Field substrate

Inference, fitted to the module map in `docs/architecture/README.md`:

- Three tiers of field, by scale and rate.
  1. World-wide static: baked at build time (ADR-0002 §3), 256^2 over 4 km (~16 m cell) - terrain "exposure/channel" direction and speed multiplier, shelter (lee) factor, snow-line elevation, rain shadow. Ship as one KTX2/raw RG8+BA8 texture, checksummed in the manifest.
  2. World-wide slow: weather state, wetness, season - scalars in `EnvironmentSnapshot`, updated every 0.5-1 s (matches the `lowFrequency` hook).
  3. Camera-local dynamic: wind vector + gust, interaction (push), wetness mask - toroidal (wrap-around) clipmap, 64x64 at 4-8 m cells (~250-500 m), re-centred in whole-cell steps so texels do not swim. Updated at 10-20 Hz with temporal interpolation in the shader; 1 level is enough for wind, 2 levels for interaction (fine around the player at ~0.5 m).
- CPU vs GPU. Wind and wetness are cheap, analytic and needed by CPU readers (audio, AI, sails, buoyancy), and the audit forbids GPU to CPU readback. So the authority is CPU, computed in pure `src/env`; the GPU gets an uploaded copy. This is the same pattern as the baked terrain lattice. WebGPU compute is therefore not required, and WebGL2 Lite gets identical data via `DataTexture`. Reserve compute for fields with no CPU consumer (interaction trails, foam advection).
- Readers (fact for the spec list, inference for counts): vegetation sway, particles/rain angle, ocean wave direction/choppiness, cloud advection, sails/flags, audio (wind loudness, rustle), AI (sound/scent, smoke), hull forces. All should sample through one function, `sampleWind(x, y, z, t)`, whose CPU and TSL versions are tested for equality against shared fixtures.
- Layout: SoA, `Float32Array` per channel for CPU; GPU as RGBA16F (wind xy, gust, turbulence). Avoid 3D textures on the Lite path. Memory is registered with `memoryRegistry`.

### 2. Wind

Facts:
- Ghost of Tsushima: wind is simulated with invisible "vorticle" particles that other particles sample, with "volume over accuracy" as the stated priority; grass motion reportedly driven by a scrolled 2D Perlin texture (secondary source only, not verified against slides). 
- Crysis/GPU Gems 3 ch. 6: procedural tree animation in layers - large-scale trunk bend, medium branch motion, small leaf flutter - driven by a wind field.
- Horizon talks (vegetation) are reported to use the same large/medium/small decomposition.
- Fjord channelling (Svalbard study; Tellus A for SW Norway): two regimes - forced channelling when the large-scale wind has an along-fjord component, pressure-driven channelling when it is across; flow switches sharply between up- and down-fjord over a narrow range of directions. Katabatic downslope flows occur on slopes. Local topography strongly modifies flow in western Norwegian fjords.

Inference, recommended model:
- Global vector: from weather - speed ranges (clear 2-5 m/s, cloudy 5-8, rain 8-12, storm 18-28; tunable) and a direction random-walked slowly from the seed (deterministic).
- Channelling: at bake time derive, from the real DTM, a fjord-axis direction map (smoothed gradient of the valley floor / ridge distance). At runtime blend: `v = lerp(v_global, axis * sign(dot(v_global, axis)) * |v_global| * k, channel_strength)` which reproduces the sharp up/down switch. Add a night katabatic term: downslope direction from terrain gradient x (1 - sun elevation factor) x slope, small (1-3 m/s), clear nights only. Add shelter/lee factor via a bake-time horizon-in-wind-direction test (8 compass sectors precomputed).
- Gusts: two scrolling noise octaves advected at 0.6x wind speed, amplitude scaled with speed and weather; one scalar `gust` in 0..1 plus a turbulence scalar. Generate in the texture build, not per-vertex.
- Consumption in vegetation: wind vector and gust come from the texture (or even one uniform for G2 start); per-blade/leaf frequencies in shader following the 3-scale decomposition. This keeps G2 independent of the field size.
- Ocean: feed wind speed/direction to the Gerstner spectrum from the same snapshot (already +z drift hard-coded).

### 3. Force fields and physics

Facts:
- Rapier's JS/wasm build is documented as fully cross-platform deterministic; hashing `takeSnapshot()` bytes after equal steps matches across machines; `Math.sin/cos` in inputs can differ by platform, so inputs must be deterministic (rapier.rs determinism guide).
- No credible public browser benchmark compares Rapier, Jolt and cannon-es; claims are anecdotal (cannon-es "slow", Rapier 2-5x faster, unsourced). A Godot-hosted native test favoured Rapier over Jolt in most scenes (not the wasm builds).

Inference:
- Buoyancy/sails/flags do not need a rigid-body engine. Hull: 8-24 sample points, evaluate Gerstner height + wind at each (pure function), integrate 6-DOF with fixed-step semi-implicit Euler in `src/world`. Spec §14.2 `calculateHullBuoyancy(hullSamples, waveField, mass, time)` is exactly this. Sails: per-sail quad, apparent wind from `sampleWind` minus ship velocity, lift/drag coefficients by angle of attack. Flags: render-only verlet strip in the shader, wind from the texture.
- Debris/props: Rapier wasm (~2 MB wasm, est.) in the sim worker, capped bodies (e.g. 64 awake), sleeping, simple colliders only; terrain as heightfield collider from the baked lattice. Jolt wasm is more featureful (vehicles, soft bodies) but heavier and has less JS ergonomics; cannon-es is JS, slow and non-deterministic across engines (math library variance). Pick Rapier, subject to a G-gate spike on the Adreno device measuring ms/tick at 100/200/500 bodies.
- Vegetation interaction: no physics. Render pass writes discs (player, boat, NPC, projectiles) into a 128^2 camera-centred R16F/RG8 texture, decays each frame; grass shader bends away along the gradient. Sources come from sim snapshots.

### 4. Determinism, tick, order, serialization

- Fixed tick 60 Hz in the sim worker (spec §18.1 forbids mixing system ms, fixed-step seconds and independent vegetation timers). Render interpolates between the two latest snapshots.
- Order per tick (proposal): input -> snapshot time/weather advance -> env fields rebuild (wind, wetness, interaction) -> force layer (buoyancy, sails) -> rigid-body step -> gameplay/AI -> publish snapshot (transferable buffers, no SAB).
- Determinism tiers: gameplay-visible values (wind at hull, sails, wetness, buoyancy) are pure functions of (seed, sim tick, weather state), using a seeded integer hash and no `Math.random`; transcendental calls wrapped (`Math.sin` differences) or replaced by polynomial tables for physics-relevant paths. Render-only gust detail may use real time.
- Serialization: store `{ seed, tick, weather state machine state, slow fields (wetness mask, snow depth) }`; fast fields are rebuilt, not saved. Include a field version in the snapshot (`windFieldVersion`, `wetnessVersion` already named in §18.1). Rapier state via `takeSnapshot()` if bodies must persist; otherwise despawn debris on save.

## Sources

- Repo: `docs/adr/0002-target-architecture.md`, `docs/architecture/README.md`, `docs/reference/game-spec-v1.md` (§14.2, §16, §18.1), `src/env/weather.ts`.
- Ghost of Tsushima wind (vorticles): https://gamedeveloper.com/design/using-vorticles-to-simulate-wind-in-i-ghost-of-tsushima-i- ; talk listing https://gdcvault.com/play/1027350/Blowing-from-the-West-Simulating ; grass noise claim (secondary): https://threadreaderapp.com/thread/1688939411575119872
- GPU Gems 3 ch. 6 (procedural tree wind): https://developer.nvidia.com/gpugems/gpugems3/part-i-geometry/chapter-6-gpu-generated-procedural-wind-animations-trees
- Horizon vegetation (placement talk, wind not confirmed): https://www.guerrilla-games.com/read/gpu-based-procedural-placement-in-horizon-zero-dawn
- Rapier determinism: https://rapier.rs/docs/user_guides/javascript/determinism/
- Physics comparisons (anecdotal): https://discourse.threejs.org/t/rapier-vs-cannon-performance/53475 ; https://forum.godotengine.org/t/physics-engine-comparison-rapier-vs-godot-vs-box2d-3d-vs-jolt/142786 ; https://developer.playcanvas.com/user-manual/physics/ammo-alternatives/
- Fjord channelling: https://polarresearch.net/index.php/polar/article/download/9263/20262?inline=1 ; https://informahealthcare.com/doi/abs/10.3402/tellusa.v64i0.11962 ; https://hdl.handle.net/1956/22247

## Open questions

1. Is the gust/sway fidelity of G2 satisfied by one uniform plus noise, or does the owner want visible wind "waves" crossing fields (needs the 64^2 texture)?
2. Will boats collide with the quay and each other (needs Rapier early) or only float (own layer suffices)?
3. Do gameplay systems (sailing, AI) depend on wind enough to require cross-device bit-exactness, or is tolerance acceptable? That decides the transcendental-function policy.
4. Real wind climatology for Hellesylt (Storfjorden/Geirangerfjord axes) was not found; need station data (MET Norway) to calibrate speeds and the fjord-axis directions.
5. Physics wasm size and ms/tick on Adreno 8xx are unmeasured; Unreal's wind source model and Horizon's wind details were not confirmed from primary sources.
6. Audit: new `src/env` field code must obey the pure-layer rule; the uploaded-texture path needs `@hot`/`@amortized` tags.
