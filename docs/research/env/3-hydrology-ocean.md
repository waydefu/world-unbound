# Hydrology and ocean dynamics for WORLD UNBOUND (Hellesylt)

Legend: **[F]** = fact with source in Sources; **[I]** = inference / engineering judgement / from memory, unverified. Web search quota was thin: several numbers below are explicitly unverified.

## Summary

- Repo state: 4-wave Gerstner (`src/env/ocean.ts`), camera-centred grid, 512x512 seabed texture at 4 m (`seaFloor.ts`, synthetic below the coast), noise-texture detail, shore foam, no refraction/SSR/underwater/wake/tide (g1.4 spec "out of scope": SSR, refraction, boats/buoyancy). Spec section 14 already demands shared CPU/GPU wave functions (`sampleWaveDisplacement`, `calculateHullBuoyancy`), a single `EnvironmentSnapshot` with `tidePhase`/`seaLevel`, and warns pure FFT does not give breaking surf.
- Keep Gerstner (extend to 6-8 waves + one cheap tileable displacement/normal texture); do NOT adopt full FFT on the phone. A fjord is a sheltered basin: waves are small, so the visual win is in fetch-limited sea state, tide, wakes and water colour/refraction, not spectral realism.
- Tide: deterministic harmonic clock (M2, S2, N2, K1, O1), amplitude ~+-0.5-1.0 m [I]; apply as a global `seaLevel` uniform + CPU offset. Cheap, high payoff (moves foam line, pier heights, boat draft).
- Bathymetry: real open data exists (Kartverket "Sjokart - Dybdedata" CC BY 4.0 [F]; EMODnet ~115 m [F]) but the 5 m seabed DTM is classified inside 12 nm [F], so use depth soundings/contours to *constrain* a synthetic model, not to replace it.
- Waterfall/river: authored hero asset (ribbon mesh + flipbook sheets + mist + splash ring), river from D8 flow accumulation on the existing DTM baked into a flow-map/width texture. Wetness = one global accumulator driving material uniforms.
- Mobile reflections: sky probe (already via `sky.radiance`) + cheap planar/"screen-strip" reflection for near boats and village; skip general SSR on Adreno until profiled.

## Recommendations

| # | Item | Approach | Mobile cost (est. [I]) | Data layout | Roadmap |
|---|---|---|---|---|---|
| 1 | Tide clock | 5-constituent harmonic sum, CPU, in EnvironmentSnapshot | ~0 | `Float32` amp/phase/speed table (5x3); `seaLevel` uniform | Next with weather/time work (small, G2-parallel) |
| 2 | Fetch sea state | Per-wind-dir effective fetch from DTM raycast (precomputed 16-dir table), SMB/JONSWAP-lite Hs,Tp | CPU only | `fetch[16]` per region + Hs/Tp uniform -> scales `waveSet` amp/wavelength | With Weather (wind) |
| 3 | Wave function | Gerstner x 6-8 + tiling baked normal/foam texture (existing noise) ; one shared TS/TSL function so CPU buoyancy == GPU | +0.3-0.6 ms GPU | uniform arrays; 256^2 RGBA8 detail | Extend G1.4; precondition for boats |
| 4 | Wakes | Camera-centred 256^2 ping-pong "ripple height + foam" RT, 0.5 m texels, hull stamps | 0.3-0.5 ms (RG16F 256^2, 1 pass + 1 stamp) | RT RG16F, world-snapped; sampled in ocean VS/FS | With boats (G-boats) |
| 5 | Buoyancy | 4-8 hull sample points x same wave fn on CPU, damped spring | <0.05 ms | `HullSample[]` | With boats |
| 6 | Bathymetry | Constrain synthetic depth with real soundings (see Details) | none at runtime | extend 4 m texture, add 16-bit depth + "bottom type" channel | After G2; before underwater |
| 7 | River | D8 on DTM -> flow accumulation -> polyline -> ribbon mesh + flow-map texture | mesh <0.2 ms; flow-map UV scroll | per-river spline (pos, width, depth, speed) + 128^2 flow texture per river tile | After G2 (needs village layout) |
| 8 | Waterfall | Hero mesh (ribbon, vertical flow-scroll + noise), flipbook spray cards, mist volume, splash foam ring, audio | 0.5-1 ms (overdraw!) | 1 mesh, 4x4 flipbook 512^2, ~200 particles | With village hero set-piece |
| 9 | Wetness/puddles | Global `wetness` 0-1 (rain accumulate/dry), material uniform: darken albedo, drop roughness, puddle mask from height-curvature + noise | ~0.1 ms | 1 float uniform + baked puddle mask (R8 per chunk or analytic) | With rain (HANDOFF item 2) |
| 10 | Refraction/colour | No screen refraction on terrain: analytic Beer-Lambert from bathymetry texture depth + bottom colour; offset sample of opaque colour only in shallows | 0.2-0.4 ms | depth tex already exists | Next ocean polish |
| 11 | Caustics | Animated tiled caustic texture projected on seabed/piers within 0-6 m depth, sun-aligned | 0.1-0.2 ms | 128^2 tileable, 16 frames or procedural | With refraction |
| 12 | Underwater | Camera-below-surface mode: fog colour/extinction, god-ray-lite, surface seen from below; swap ocean material | 0.3 ms | uniform set only | Low priority; gameplay-driven (fishing/diving) |
| 13 | Breaking foam | Foam from steepness (Jacobian of Gerstner = free) + shore depth/slope; advect via wake RT | 0.1 ms | shared with wake RT | With wakes |
| 14 | Reflections | Sky probe (done) + planar mini-reflection of near scene at 1/4 res only when boat/pier in view; SSR deferred | planar 1-1.5 ms [I] | 1/4-res RT | After G2/buildings; measure first |

## Details

### 1. Fjord ocean

**Tides.** Norwegian reference is chart datum (sjøkartnull) [F: Kartverket tide pages]; Kartverket exposes observed/forecast levels incl. an Ålesund gauge (AES) via an open API [F]. Hellesylt is inner-fjord, ~Storfjorden system; M2 is the dominant constituent on the Norwegian coast with semi-diurnal pattern [F: Frontiers 2024 — its M2 values for Maloy/Rorvik etc. are far from Hellesylt, unit unstated]. I did not retrieve Ålesund/Hellesylt harmonic constants or springflo range. Inference [I]: Sunnmøre mean spring range roughly 1.2-1.8 m, so amplitude of M2 ~0.5-0.6 m, S2 ~0.15-0.2, N2 ~0.1, K1 ~0.08, O1 ~0.06. **Action:** pull the real constants (Kartverket "Se havnivå" API for Ålesund/Hellesylt station, or fit by least squares to a 30-day water-level download; NOAA notes >=30 days are needed for constituent fits [F]) and ship them as a 5x3 table. `h(t)=Z0+sum A_i f_i cos(w_i t + (V0+u)_i - g_i)`; ignore nodal factors f,u for a game (<~5%) [I]. Epoch must be UTC-based from the calendar clock, deterministic, stored in EnvironmentSnapshot (`tidePhase`,`seaLevel`) per spec 18.1. Tide in a sheltered fjord moves slowly: no visible "current" except at constrictions (skip).

**Wind fetch.** Sunnylvsfjorden ~26 km long, ~2 km wide max [F: Wikipedia]; inner fjord near the quay ~900 m wide, min 50 m deep [F: cruise-norway pier PDF]. Hence waves are strongly fetch-limited and *directionally* constrained: wind along the fjord axis builds a short steep chop (Hs maybe 0.3-0.8 m, Tp 2-4 s for ~10-15 m/s over ~10 km) [I]; cross-fjord wind gives ~0.1-0.2 m. Use the JONSWAP/SMB fetch-limited formulas (Hs ~ 0.0016 U^2/g * sqrt(gF)/U ... deep water) [I, standard coastal engineering]. Precompute effective fetch for 16 wind directions by marching DTM rays from the player's area (CPU, once). Output: Hs/Tp -> scale the 4->8 `waveSet` (wavelength set follows Tp, amplitude follows Hs). Swell from outside is effectively absent this deep in a fjord (attenuated) [I] — so "storm" should be chop plus gust sheets (cat's-paws, darker patches), a cheap noise texture mask driven by wind; this reads as fjord wind far better than big waves.

**FFT vs Gerstner.** Tessendorf FFT needs ~3 passes of 5-9 butterfly stages on 128-256^2 complex textures per cascade; 2-3 cascades are needed to avoid tiling [I]. On Adreno, bandwidth-bound compute at 256^2 x3 cascades is likely 1.5-3 ms [I, unmeasured] of a ~11.5 ms budget when ocean+terrain+shadows already sum ~11-13 ms (HANDOFF: gpu Σpass 11-13 ms at 60 FPS). Fjord waves are short and low, so the visual gain is small. Recommendation: Gerstner (6-8 waves, CPU-identical function) + baked tiled normal/foam detail map (already have noise) + Jacobian-based foam. Keep an optional FFT "high tier" behind the quality tier switch only if profiling on phone shows >1.5 ms headroom. Spec 14 already notes FFT alone does not give shore breaking [F: repo].

**Wakes/boat interaction.** Best mobile practice [I]: a camera-snapped ripple heightfield RT (ping-pong wave equation, 256^2, ~0.5 m/texel => 128 m window) plus a foam-trail channel written by hull stamps (line/capsule quads) and advected with decay. Ocean VS adds height; FS adds normal + foam. Small rowing boats: 2-4 oar-splash stamps. Cost one 256^2 RG16F pass x2 per frame. Bow/stern V-wakes (Kelvin) are only needed for a few large ships: bake as a stamp texture along the hull path rather than simulate.

**Buoyancy.** Single `sampleWaveDisplacement(x,z,t)` in `src/env` used by both TSL (via a mirrored node implementation, with a unit test comparing the two numerically, same pattern as other CPU/GPU pairs) and the CPU. Horizontal Gerstner displacement means sampling at the *rest* xz needs a 1-2 iteration fixed-point inversion [I]. Add tide offset and wake RT only visually (no CPU readback) — keeps CPU authority per spec 18.2.

### 2. Bathymetry
- **Kartverket Sjokart - Dybdedata**: depth soundings/contours, CC BY 4.0, free download via Geonorge (FGDB/GML/PostGIS/SOSI), continuously updated [F]. Good for sparse depth points and generalized contours (use as constraints: kriging/TIN to ~10-25 m grid, then add noise).
- **Kartverket "Terrain models of the seabed"**: 50 m grid downloadable (NED/TIFF/XYZ) [F]; 5 m grids classified inside 12 nm, so unavailable for the fjord; survey data would need declassification (ask sjodata@kartverket.no) [F]. 50 m is coarser than our 4 m texture: use as base trend, add detail procedurally.
- **CATZOC** (confidence zones) dataset, CC BY 4.0 [F] — tells where depths are trustworthy.
- **EMODnet Bathymetry DTM**: 1/16 arc-minute (~115 m), open and free [F]; exact licence text not confirmed; too coarse for a 2 km fjord (use only for the open-sea fringe). Mareano multibeam in fjords: no confirmed resolution/licence found [unverified]. GEBCO (15 arc-sec ~ 450 m) is public domain-style but far too coarse [I].
- **Plan:** Fjord walls are steep (the DTM land slope continues below the surface, [I]): fit depth = f(distance to coast, local land slope) with fjord U-profile, then correct with 50 m grid / sounding points via residual field (bilinear residual texture at 16-32 m, RG: residual + bottom-type). Store in the existing seafloor texture as Float16 + a second R8 for sediment/rock (tints colour in shallows). Seabed visible to ~8-15 m only (Norwegian fjord water is tea/green with river meltwater; strongest absorption red) so detail below 20 m is invisible: spend effort on 0-15 m near piers, steep rock shelves, and a harbor dredged-basin shape. Hand-author the quay area.

### 3. Rivers and waterfall
- Facts: Hellesylt waterfall in the village centre feeds Sunnylvsfjorden via Hellesyltelva [per brief; not re-verified online].
- **Data:** Kartverket DTM (already in repo) -> pit-fill -> D8 flow direction -> flow accumulation (O'Callaghan & Mark 1984) [I, standard]. Threshold gives the river centreline; width ~ a*Q^0.5 hydraulic geometry [I]. Do it as an offline script emitting a polyline + width/depth/speed attributes; hand-edit through the village (the real river is canalised).
- **Render:** ribbon mesh (the camera-centred terrain grid may be too coarse at 1-2 m) with flow-map technique (two-phase UV advection, Valve "Water Flow in Portal 2"-style [I]) using the existing noise textures; foam where slope > threshold; depth-based opacity with bank blend. Cost small as area is tiny.
- **Waterfall:** vertical ribbon with stretched-noise scroll + soft particles at the base + 2-3 mist billboards (low alpha, big, additive/soft) + splash foam ring on the pool; spray flipbook 4x4. Overdraw is the mobile risk — cap quads, 1/2-res for mist if needed. Add waterfall audio (large, positional). Collisions: none.
- **Wetness:** global `wetness` scalar integrates precipitation, decays with time/sun; applied to terrain/building materials as albedo*(1-0.4w), roughness lerp to 0.3, plus puddles via height-curvature mask on flat ground thresholded by wetness^2 with reflection of sky probe. Runoff streaks on slopes: optional later.

### 4. Missing water rendering
- **Refraction/colour:** Beer-Lambert from known depth (texture) is almost free; true screen-space refraction needs an opaque-scene copy (extra RT copy ~0.4-1 ms on tilers, [I]). Use it only in <3 m depth via a small UV offset or skip, using depth-faded transparency of the seabed instead.
- **Caustics:** animated tiled texture projected along the sun on seabed/quay stones, faded with depth (sun-lit only, <5 m).
- **Underwater:** ocean material 2-sided variant, fog colour from extinction, depth-dependent exposure; surface-from-below uses Snell's window (cheap UV trick). Only when gameplay needs it.
- **Reflections:** Sky is a probe (done). SSR on a tiler is costly (hierarchical march + extra depth/colour reads) and breaks at screen edges (spec 14.4 warns); fjord water is dark and rough, so planar of nearby geometry at 1/4 res is enough; mountain mirror in the fjord is the iconic look: consider a *terrain silhouette* reflection (low-res heightfield cubemap/horizon strip, [I]) – very cheap, high value.

## Sources
- Kartverket Sjokart Dybdedata product sheet (CC BY 4.0; formats): https://dokument.geonorge.no/produktark/dybdedata/20210204/produktark-sjøkart-dybdedata-kartverket-20210204.pdf ; https://data.norge.no/en/datasets/946d865a-e9ac-439e-8cbf-15de7ada9a3f/sjokart-dybdedata
- Seabed terrain models 50 m / 5 m: https://geonorge.no/geonetworktest/srv/api/records/67a3a191-49cc-45bc-baf0-eaaf7c513549 ; https://www.geonorge.no/geonetworktest/srv/api/records/13b707ad-a379-4bf0-a707-da237d646f44
- Data quality / CATZOC: https://geonorge.no/geonetworktest/srv/api/records/ac668c06-43c8-4c31-9910-93139abd24b0
- Kartverket tide API and gauges (Ålesund AES, chart-datum heights): https://vannstand.kartverket.no/tideapi_protocol.pdf ; https://kartverket.no/en/at-sea/se-havniva/tides-and-water-level/permanent-tide-gauges
- Norwegian coast M2 study: https://www.frontiersin.org/articles/10.3389/fmars.2024.1328171
- NOAA on harmonic constituents (30-day rule): https://tidesandcurrents.noaa.gov/about_harmonic_constituents.html
- EMODnet DTM 2024 (1/16'): https://emodnet.ec.europa.eu/en/emodnet-bathymetry-dtm-2024-release
- Sunnylvsfjorden geometry: https://en.wikipedia.org/wiki/Sunnylvsfjorden
- Hellesylt pier (900 m wide, min 50 m): https://cruise-norway.no/wp-content/uploads/2025/04/Hellesylt-Port-facilities-and-services-2026.pdf
- Repo: docs/reference/game-spec-v1.md s14, s18; docs/specs/g1.4-ocean.md; docs/HANDOFF.md.

## Open questions
1. Actual harmonic constants/tidal range for Hellesylt (nearest gauge Ålesund AES or a closer one?) – needs a Kartverket API pull; everything numeric above about amplitudes is [I].
2. Is declassified Kartverket/Mareano multibeam for Sunnylvsfjorden obtainable (email sjodata@kartverket.no)? Mareano resolution and licence unverified.
3. FFT cost on the target Adreno is unmeasured; need a spike on the existing GPU-ramp page before ruling in/out.
4. Does the ocean currently run in a separate pass from opaque terrain (affects cost of a refraction copy)?
5. Real river course through the village is canalised: what level of fidelity does the owner want (hero art vs DTM-derived)?
6. Wake RT and tide-induced `seaLevel` change must be added to the EnvironmentSnapshot and ocean version contract (sec. 18) – needs owner approval for governance of schema if under protected files.
