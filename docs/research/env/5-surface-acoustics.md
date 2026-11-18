# Surface interaction, material states, environmental acoustics (Topics A+B)

## Summary
- Store surface state as a few low-rate, world-space, camera-centred clipmap textures (RGBA8, ~128x128 m cells of 0.5-1 m near, 2 cascades) plus a CPU-side coarse grid of the same fields. GPU copy feeds terrain/building/vegetation materials; CPU copy feeds footsteps, audio and gameplay (single source of truth: CPU simulation, GPU upload at 2-5 Hz).
- Wetness/snow/frost/mud are scalar *states* with per-material porosity and exposure; evaluate them in the existing `evaluateMaterialLayers(...)` contract (spec 12.3). Footprints are a separate, high-rate 1-2 channel trail target around the player only.
- Audio: procedural synthesis in one AudioWorklet (noise beds: wind, rain, surf, waterfall) plus a small pool of cheap spatial voices (equalpower, not HRTF). Drive everything from the same sampled environment fields. Reverb = one shared ConvolverNode/feedback-delay send whose wet/size comes from a coarse ray-probe of the fjord walls.
- Haptics: optional, Android-only (Vibration API absent on iOS), gated by user gesture. Provide visual/caption equivalents of every ambient cue.
- Roadmap: wetness + footstep surface type in Milestone 1/3 (already scheduled: "雨濕調變 PBR", Web Audio at M3); snow/frost/ice/trails after M2; moss is baked/static, not simulated.

## Recommendations
1. **One `SurfaceState` field set** (per cell): R wetness, G snow depth (water-equivalent), B frost/ice, A mud/puddle depth. Static (build-time baked) companions: porosity/material id, moss/lichen mask, drainage/slope/exposure (sky-view) from terrain data.
2. **Simulate on CPU/worker at 2-5 Hz** over the active window only (~256x256 cells = 64k cells x 4 B = 256 KB; trivial). Upload via `DataTexture` partial/whole update (<=256 KB per 0.25-0.5 s). Two cascades (near 0.5 m/cell x 128 m; far 4 m/cell x 1 km) ~0.5 MB total.
3. **Wet look in shader, not in state**: wet = darker albedo (porosity-weighted), lower roughness, water F0=0.02; puddles from depth threshold + height/normal-blended noise; ripple normals animated only where rain-rate>0. Cost: ~3-6 ALU + 1 clipmap fetch per pixel; sample once per terrain fragment, reuse for all layers.
4. **Snow**: accumulation = rate x exposure (sky-view/ceiling, wind-shadow, slope < angle of repose) ; melt = f(temperature, sun, rain). Shade as a top layer (normal-based blend, sparkle only if cheap). Vertex displacement only near the player.
5. **Footprints**: player-centred 512x512 R8/RG8 trail target (~0.25 MB, ~0.2 m/cell, 100 m), scrolled by texel snapping, decays toward recovery per surface (snow slow, sand fast); stamp = small quad draw per foot. Apply only as normal/darkening on terrain + displacement in a near ring. Skip on the WebGL2 low tier.
6. **Audio runtime**: a single AudioContext, `latencyHint:'interactive'`, one or two AudioWorklet nodes for noise beds (filtered noise is cheap: ~1-3% of a mid-phone core), `PannerNode` panningModel `equalpower` for <=8 positional voices, hard voice cap (~16 total, ~8 spatial), priority by loudness/distance. Prefer analytic stereo (pan+gain+LPF by distance) for waterfall/surf *area* sources: place the source at the nearest point on a polyline/polygon to the listener.
7. **Occlusion/reverb**: every 100-200 ms cast ~8-12 rays (CPU heightfield march, deterministic) around the listener; derive openness, wall distance -> reverb send level and pre-delay (fjord echo 100-400 ms), plus lowpass for terrain between source and listener (heightfield line-of-sight, 1 ray per active spatial voice).
8. **Drive from fields**: wind speed -> bed gain/cutoff + gust LFO; rain rate -> density of drops + wetness-dependent surface timbre (rain on wood/stone/water/leaf by surface under listener); distance to water/waterfall (from SDF/coast data) -> surf/waterfall level and lowpass; time of day/season -> bird density (none in snow/night).
9. **Footstep type** = lookup of (material id, wetness, snow, mud, frost) -> synthesis preset; CPU sample at foot-plant events, no GPU readback.
10. **Feedback**: lens drops as a screen-space overlay shader (few droplets, capped), cold breath as 2-4 sprites below a temperature threshold, vibration for impacts only, captions/visual cues for wind/rain/surf/bell with a user toggle. Respect `prefers-reduced-motion`.

## Details
### A. Material states
**Facts.** Lagarde's "Water drop" series covers rain, wet-surface PBR and dynamic rain (index at the 3dvf link; part 3b content not retrieved). A shader gist based on Lagarde part 1 sets water F0 to 0.02 (IOR 1.33). Academic wet-porous models (WetSpongeCake) use porosity and saturation as parameters; a real-time GPU model of absorption/evaporation exists (Visual Computer 2021). Runtime snow/trail systems commonly use a render-target mask projected onto the ground (UE tutorials; origin: Arkham Origins GDC 2014; God of War Ragnarok GDC talk is the primary source for deep snow, not retrieved).

**Inference (project-specific).**
- Wetness model per cell: `w += rain*(1-shelter)*dt/porosityCapacity; w -= (evap(sun,wind,temp) + drainage(slope))*dt`. Porous material (earth, sand, wood) saturates and dries slowly (hours game-time) and darkens strongly; stone/cobble darkens little and holds puddles in low spots; metal/roof tile dries fast. Table of ~8 material constants (capacity, dry rate, darken factor, roughness delta).
- Puddles: only on low-slope cells; use the already deterministic heightfield to precompute a "concavity" map at build time (stream with terrain tiles in a spare channel, or compute from the 4-neighbour Laplacian at CPU sim time).
- Snow at 62 N: seasonal (spec has 32-day season calendar); sim by snow water-equivalent, shows depth as threshold on slope + noise so cliffs stay dark. Melt couples back into wetness (meltwater) and mud (earth under snow thaw).
- Frost/ice: frost = function of temperature < 0 and clear sky; fjord-edge ice only in shallow cells (use sea-floor depth data already in `src/world/seaFloor.ts`) as a mask in the ocean material (roughness low, ripple suppress), keep decorative—no physics.
- Moss/lichen: static bake from slope, aspect (north-facing), moisture, age; per-building via `evaluateMaterialLayers` deposits input. No runtime growth sim; at most a season scalar.
- Buildings/vegetation: sample the same clipmap by world XZ (buildings also use their own roof/wall exposure; roofs get snow by normal.y, walls get rain streak by exposure). Foliage: wetness darkens and drops wind-sway amplitude slightly; snow only on tops (normal.y).
- Texture budget on mobile: near+far clipmaps 0.5 MB, trail 0.25 MB, no MRT; fits easily inside the memory registry. Updates are CPU->GPU uploads, not render passes, so no extra GPU pass except trail stamps (<0.1 ms).
- Existing code: terrain material has a single `wetness` uniform and `setWetness` (hot path writes an existing uniform). Migration: keep uniform as global rain scale; add clipmap sampler + origin/scale uniforms; same pattern (uniform updates only).

### B. Acoustics
**Facts.** Web Audio render quantum is 128 frames (~2.9 ms at 44.1 kHz); worklet code must fit that budget or glitches occur (Chrome AudioWorklet design pattern). Worklet cost scales with number of AudioParams (cprimozic). A game-audio guide claims HRTF panning is ~10x equalpower and that mid-range phones strain at ~20-30 spatial sources, low-end 10-15 (unverified vendor blog; no device benchmark found). Chromium's configurable render-quantum hint exists but may be ignored. `navigator.vibrate` works on Chrome/Firefox Android, needs user activation, is not implemented in WebKit/any iOS browser; Firefox desktop removed it (W3C implementation report; MDN).

**Inference.**
- Synthesis choices: wind = band-passed pink/brown noise with 2-3 slow LFO/gust envelopes (+ tonal whistle formant on high speed); rain = filtered noise bed + sparse Poisson drop grains (rate ~ rain mm/h) with surface-dependent filters; surf = noise swept by a wave-phase envelope tied to the ocean model's wave period; waterfall = broadband noise (1/f) with distance-lowpass; birds = a few FM chirp voices on random timers (budget 2-3 active); town = distant hammer/murmur grains + church bell (inharmonic partial bank, 8-12 sinusoids with decaying envelopes), generated at start-up into a short buffer cached in memory (avoids per-frame cost).
- Prefer pre-rendering short loops/grains with `OfflineAudioContext` at boot (zero external files stays true) and play via `AudioBufferSourceNode`; use the worklet only for continuously modulated beds. Memory: 10 s mono 32 kHz float32 ~1.3 MB per loop; keep <= 8 MB total.
- Main-thread isolation: audio control updates at 10-20 Hz via `AudioParam.setTargetAtTime`, never per frame; field sampling runs in the same worker as the environment sim.
- Reverb: a single shared convolver with a procedurally generated impulse (exponential-decay noise) regenerated only when the openness class changes (crossfade two convolvers); fjord = long pre-delay slap-back echo from sampled rays.
- Accessibility: ambient captions (e.g. "[wind rises]", "[rain on roof]", "[bell tolls]") driven by the same field thresholds with hysteresis; visual wind/rain direction indicators; mono/downmix option; volume sliders per bus; captions must not rely on audio-only state.
- Camera/screen: lens droplets as a fullscreen quad with ~16-32 procedural drops (<0.3 ms on tile GPU if drawn in the final composite pass only); cold-breath sprites cheap. Disable lens effect in first-person-underroof (rain exposure = 0).

### Layering (inference; verify against scripts/audit.mjs)
- `src/world/surfaceState.ts` (pure CPU sim, deterministic, no DOM) ; `src/env/` owns weather inputs (rain, temp, wind) already; `src/render/surfaceTextures.ts` uploads; materials only read uniforms/samplers; new `src/audio/` (AudioContext, worklets, voice manager) depends on `env` + `world` queries only, not on `render`.
- Worklet source must be a separate module URL (bundled by Vite); keep main-thread audio API in `src/platform`-style wrapper with capability fallback (no worklet -> buffer sources).

## Sources
- Lagarde water-drop series listing (3dvf): https://3dvf.com/actualite-5676-sebastien-lagarde-simulation-pluie-en-jeu-video-html/
- Wet-surface shader gist based on Lagarde (F0 0.02): https://gist.github.com/eviltak/e04b83ffdb91aa3d477bbfe0ca370da7
- WetSpongeCake / micro-ellipsoid wet porous model: https://arxiv.org/html/2401.15628v3
- Real-time wet absorbent materials (Visual Computer 2021): https://link.springer.com/article/10.1007%2Fs00371-020-01963-w
- Render-target snow trails tutorial: https://www.kodeco.com/5760-creating-snow-trails-in-unreal-engine-4
- God of War Ragnarok snow (80.lv): https://80.lv/articles/santa-monica-s-senior-programmer-on-how-god-of-war-ragnar-k-s-snow-system-was-made
- Chrome AudioWorklet design pattern (128-frame budget): https://developer.chrome.com/blog/audio-worklet-design-pattern
- AudioWorklet param cost: https://cprimozic.net/blog/webaudio-audioworklet-optimization/
- Configurable render quantum intent: https://groups.google.com/a/chromium.org/g/blink-dev/c/i4c1unRSmcE
- Web game audio performance (HRTF 10x, source counts; unverified): https://www.abratabia.com/web-game-audio/audio-performance.php
- Vibration API implementation report: https://w3c.github.io/vibration/reports/implementation.html
- navigator.vibrate docs: https://docs.w3cub.com/dom/navigator/vibrate

## Open questions
- Lagarde part 3b content and the God of War Ragnarok GDC snow talk were not retrieved; fetch before committing to a snow-depth/parallax design.
- No measured PannerNode/HRTF or worklet cost on Adreno 8xx-class phones; needs an on-device audio benchmark (voices vs. CPU %/underruns) in the platform-tier test plan.
- Is ADR-0002/audit.mjs layering OK with a new `src/audio` module and a worklet entry? Needs owner decision (governance not touched).
- Are WebGL2-fallback texture formats/update paths adequate for the clipmap uploads (RGBA8 partial updates)?
- Should vibration/haptics ship at all given iOS absence (accessibility toggle default off)?
- Fjord-ice and snow display: gameplay consequence (slipping, fishing through ice) or purely visual?
