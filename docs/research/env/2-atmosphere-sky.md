# Atmosphere, microclimate and sky phenomena for WORLD UNBOUND

Status: [F] = fact with a cited source, [I] = my inference or estimate (not device-tested). Repo state read: `src/env/weather.ts` is only an enum plus a wetness table; `src/render/sky.ts` is a sphere dome sampling the CPU-built sky-view table, adding sun/moon discs, stars and a CIE overcast blend (`overcast`, `stars` uniforms). `docs/reference/game-spec-v1.md` has no research section titled 13; its only cloud material is the API stubs near lines 227-243 (`updateWetnessField`, `generateCloudDensity`, `raymarchClouds`, `reprojectCloudHistory`, `buildCloudShadowMap`) and reference R14 (Epic Volumetric Cloud). Treat those names as the planned seam.

## Summary

- Drive everything from one deterministic, seeded, CPU-side `ClimateState` (a few scalars sampled from seed + game time). It extends the `Weather` enum rather than replacing it. Cost is negligible.
- Ship clouds in stages: Lite and phone tier get a 2.5D layered cloud dome (baked noise textures, scrolling, lit by the Hillaire sun/sky colours). Desktop tier gets a low-res raymarched volume with temporal reprojection. Phone volumetrics only if a G-series profile shows headroom.
- Precipitation is a camera-local GPU-instanced particle volume plus a screen-space streak/overlay, with a single `wetness` scalar handed to the surface-state system. Lightning is a cheap flash uniform plus a bolt mesh.
- At 62 N the signature phenomena are: white-night twilight (sun never more than ~4 degrees below horizon around solstice), noctilucent clouds, winter aurora, long golden/blue hours, fjord fog and inversions. Most cost almost nothing as sky-shader terms.
- Biggest risk to budget: volumetric clouds plus a second full-res transparent layer on Adreno. Gate behind quality tier.

## Recommendations

| Item | Approach | Tier | Mobile GPU cost [I] | Roadmap |
|---|---|---|---|---|
| Climate/weather state machine | Seeded Markov-ish synoptic front sequence + smooth-noise diurnal terms, CPU | all | ~0 (CPU, <0.05 ms) | next env milestone |
| Fog layers (valley, sea, inversion) | Analytic height-fog extension of existing exponential fog, terms in the fog node | all | <0.2 ms | with climate |
| Clouds L1 | Layered 2.5D dome: 2 to 3 scrolling alpha-noise layers, sun-lit by transmittance-based tint, horizon fade | Lite+Phone | 0.3-0.8 ms | first |
| Clouds L2 | Raymarched slab, 1/4-1/16 res, temporal reprojection, 3D noise baked at build time | Desktop (Phone optional) | 1.5-3 ms desktop; phone unproven | after profile |
| Cloud shadows | Scrolling 2D noise shadow map sampled in terrain/water lighting (not raymarched) | all | ~0.1-0.3 ms | with L1 |
| Cloud-to-sky coupling | Cloud coverage drives existing `overcast`, sun visibility and ambient SH scale | all | ~0 | with L1 |
| Rain/snow | Camera-local instanced quads (1-2 k) + screen streak layer + ripple/splash decals near camera | all (fewer on Lite) | 0.3-0.8 ms | after clouds |
| Wet surfaces | Single `wetness` + `puddle` field from climate to surface-state | all | in surface shader | hand-off |
| Lightning | Flash uniform on sky/ambient + cached bolt polyline, thunder delay by distance | all | ~0 | with storm |
| Aurora | Full-screen-sky additive term: 1 to 2 ribbon curtains from low-freq noise + height gradient | all | 0.1-0.3 ms, night only | polish |
| Noctilucent clouds | Thin high-altitude noise sheet, lit by sun depression 6-16 deg | all | <0.1 ms | polish |
| Halos/sun dogs, rainbows | Analytic sky terms keyed on sun angle + cirrus/rain flags | all | <0.1 ms | polish |
| Crepuscular rays | Screen-space radial blur from the sun, only when sun low and clouds broken | Full | 0.3-0.6 ms | polish |
| Milky Way, meteors | Milky Way equirect texture (build-time baked) in star pass; meteors as rare streak sprites | all | <0.1 ms | with stars/polish |

Placement: climate and fog first (they affect gameplay and all lighting), then L1 clouds and cloud shadows, then precipitation and wetness, then optical/astronomy polish, then L2 volumetrics behind an ADR with chapter-20 style evidence (per ADR-0002 section 1).

## Details

### 1. Weather state machine and microclimate

Design [I]:
- Keep `Weather` as the discrete label for URL params and presets, but derive it from continuous drivers: `cloudCover`, `cloudType` (stratus/cumulus/cirrus blend), `precip` (0..1), `windVec`, `temperatureC`, `humidity`, `pressureTrend`, `wetness`. Presets map the labels to driver targets.
- Synoptic evolution: sequence of "systems" generated from `hash(seed, floor(t / T_sys))` with T_sys of 6 to 18 game hours; each has onset, peak, and decay envelope (smoothstep). Between systems, 1D value noise. This is deterministic as a pure function of (seed, time), so save/load and multiplayer need only the clock. No stored state beyond `wetness`, which integrates with a drying time constant.
- Maritime-western-Norway bias [I]: weights favour cloudy/rain, with fronts arriving from W/SW; foehn-dry spells and clear cold highs in winter.
- Diurnal cycle at 62 N [I]: temperature = seasonal mean + diurnal amplitude * sin(solar phase, lagged ~2-3 h). Amplitude small in winter (~1-2 C) and larger in summer (~6-8 C); humidity is anti-correlated. Compute from the existing `calendar.ts` / ephemeris so it follows day length.
- Fjord microclimate as modifiers on the global drivers, evaluated per location from terrain height and distance to water (data the world core already has):
  - Valley/radiation fog: cold, clear, calm nights; thickness ~ (humidity high, wind low, cloud low), burns off after sunrise. Implement as a density term in height fog, with a fog-top altitude uniform.
  - Sea fog / haar: warm moist air over cold water; confined to the sea-level band, drifts inland with onshore wind.
  - Inversion: fog top clamps near a cap altitude; peaks above poke out. A single `inversionHeight` uniform lets the cloud/fog shaders show a sharp lid.
  - Orographic cloud on peaks: cloud base lowered/thickened where wind-ward slope and humidity are high. In 2.5D mode, bias layer coverage by a baked low-res terrain "windward lift" map; in volumetric mode, add to density.
  - Katabatic/anabatic winds: night downslope drainage along the fjord axis, day upslope/up-fjord sea breeze. Output as a wind vector bias that feeds water, trees (`computeWindField`) and particle drift.
- Data flow: `Climate.sample(t, pos)` -> struct consumed by sky (overcast, cloud params), fog node, precipitation, surface-state (wetness), audio, vegetation wind.

### 2. Clouds on mobile

Facts:
- Hillaire's atmosphere paper (CGF 2020) is the technique already implemented here; it targets devices down to an iPhone 6s [F, diglib.eg.org link]. The Frostbite SIGGRAPH 2016 talk covers sky, atmosphere and clouds together, intended for 30 and 60 FPS titles [F, EA link].
- Horizon Zero Dawn / Nubis: the cloud system ran under ~2 ms on PS4 [F, per search summary of Schneider's talks]; low-res rendering with partial per-frame updates and temporal reprojection is the standard approach [F, arXiv 1609.05344 describes it generally]. Exact Horizon ratios are only secondhand.
- Nubis Cubed (Advances 2023) and Nubis Evolved are the later voxel-style evolutions [F, links below].

Recommendation [I]:
- Phase 1 (all tiers): cloud dome with 2 to 3 layers (low stratocumulus ~1.5 km, mid altocumulus ~4 km, high cirrus ~8 km) drawn in the sky pass. Per layer: 1 to 2 texture taps of a baked tileable noise (we already have `noiseTextures.ts`), coverage thresholding, a cheap "powder/silver lining" lighting term using sun elevation, and a fake thickness gradient by sampling twice with an offset toward the sun. Colours: sun light from the transmittance LUT at cloud altitude (CPU already has the LUTs), ambient from sky-view zenith. This gives credible twilight clouds (pink/orange undersides) for free.
- Coupling to Hillaire sky: do not re-run the LUT with clouds. Feed `cloudCover` into (a) `overcast` blend toward the CIE overcast curve, (b) sun visibility scalar for sun illuminance and shadows, (c) ambient scale. The existing `SkyDome` already blends CIE overcast, so clouds are mostly a texture on top; CPU cost is one multiply.
- Cloud shadows: scrolling 2D noise sampled in world XZ by terrain and water materials, same coverage function as the dome so shadows match visible clouds. Cheaper and more robust than raymarched shadow maps.
- Phase 2 (Desktop, maybe Phone): raymarch a horizontal slab (~12 to 24 primary steps, 4 to 6 light steps) at quarter res in X and Y, 1-of-16 interleaved pixel update plus reprojection against history with neighbourhood clamping, composite over sky and under aerial perspective. Needs a 3D noise texture (baked at build) and wind advection. Expect heavy fill and bandwidth on a tile-based Adreno; test with fixed cameras per ADR-0002 before adoption. Use `reprojectCloudHistory` and `buildCloudShadowMap` stubs in the spec as the seam.
- Fjord context: steep walls hide most of the sky; clouds are seen in a narrow window plus on peaks. This favours spending budget on low clouds and orographic caps, and less on a full-sky volumetric.

### 3. Precipitation

- Rain [I]: a particle volume (box or cylinder ~20 m around the camera) of GPU-instanced stretched quads, positions computed in the vertex shader from time + instance id (no buffers updated per frame), streak length from velocity and exposure. 1 to 2 k particles is enough for phones; add a second sparse far layer as a scrolling streak texture. Fade and darken scene by `precip` (light-lowering via the sun visibility scalar).
- Splashes/ripples: normal-map ripple atlas on water and puddles (surface-state `puddle` mask), plus a few instanced splash sprites near the camera only.
- Snow [I]: same particle path, slower, with sine-noise drift and wind; also a snow-cover accumulation scalar for the surface-state system (white blend by slope/aspect).
- Wetness hand-off: climate writes `precip`; surface-state integrates it into `wetness` (fast wet, slow dry, slower under cover) and exposes a darkened albedo + lowered roughness. The current `WEATHER_WETNESS` table becomes the steady-state target only.
- Lightning [I]: for storm, Poisson-timed events (seeded). Effect = sky/ambient flash uniform with 2 to 3 pulses over ~0.2 s, plus a precomputed branching polyline bolt drawn as additive lines for a few frames; thunder delay = distance / 343 m/s. Negligible GPU cost.

### 4. Optical and high-altitude phenomena at 62 N

- White nights / twilight [I from geometry]: at 62.08 N at the June solstice the sun's minimum elevation is about -(90 - 62.08 - 23.44) ~ -4.5 deg, i.e. it never leaves civil twilight. Our Hillaire LUTs already render low-sun twilight colours; the work is making the star/moon/exposure terms respect that the sky never goes dark in June-July (stars faint or invisible, auto-exposure staying high). Check the existing `stars` uniform fades with sun elevation, not clock time. Winter is the opposite: sun barely above the horizon around the winter solstice (max elevation ~4.5 deg), so long golden light and low-sun shadows through the fjord walls.
- Noctilucent clouds [F]: best seen when the sun is 6 to 16 deg below the horizon (RASC; Springer abstract), seen at 50 to 65 N, rarely below 45 N and hard to see above ~75 N because of bright skies; peak season is late June through July; found near the horizon up to ~15 to 20 deg altitude. Lerwick (61.2 N) barely gets dark enough around the solstice [F, NERC]. Inference: at 62 N the sun only reaches -4.5 deg at the solstice, so the strict 6 to 16 deg window is not met at midsummer; NLCs would show around late May/early June and mid/late July to August evenings and mornings, shortly before and after the brightest weeks. Implementation: one high thin ribbed-noise sheet (altitude ~83 km, treated as a distant shell), blue-white emissive, intensity = smoothstep window on sun depression * seasonal factor (daily deterministic on/off from seed, since real occurrence is intermittent).
- Aurora [F/I]: equatorward oval edge moves roughly 1 deg in magnetic latitude per Kp step; oval typically 60 to 75 deg magnetic latitude [F, search summaries]. Inference: Hellesylt geomagnetic latitude is roughly 58 to 60 deg (geographic minus a few degrees; verify with IGRF), so aurora there requires elevated Kp and a dark sky, mainly Sep to Mar, nights, clear sky. Gameplay choice: seeded "storm nights" about once or twice a month in winter, rarer in autumn/spring, none in white nights. Rendering: additive ribbon curtains in the sky shader: a few vertical-gradient bands defined by a warped 1D noise along a bearing, green base with occasional red/pink top, animated by time; mask by darkness and cloud coverage; reflect in water via the existing sky sampling.
- Halos / sun dogs: 22 degree halo ring and parhelia when high cirrus is present and sun elevation is low to moderate; analytic ring term (radial gaussian at 22 deg from the sun, weak chromatic split) multiplied by cirrus layer opacity. Rainbows: 42 deg antisolar arc (secondary at ~51 deg) shown when sun elevation <~40 deg, rain on one side and sunlit sky; analytic spectral gradient keyed on angle to anti-sun point, intensity from `precip` near-field falling plus broken cloud. Both are near-free sky-shader terms.
- Crepuscular rays: screen-space radial blur toward the sun from a bright-sky mask (also used for the sun glow), enabled when the sun is low and cloud cover 0.3 to 0.7; fjord walls create natural light shafts, so a volumetric-fog-with-shadow variant is a later upgrade if shadows are available.
- Milky Way and meteors: bake a Milky Way texture (public-domain ESA Gaia sky map) into an equirect HDR; rendered in the star pass, multiplied by darkness factor, so it is only visible in autumn to early spring nights [I]. Meteors: seeded Poisson timer (~1 per minute at night, peaks mid-Aug Perseids / mid-Dec Geminids), a short fading streak sprite.
- Twilight colours: already Hillaire-driven; add an ozone-absorption sanity check (blue hour comes from ozone Chappuis band) and verify against reference photos per the project's blind-review process.

## Sources

- Hillaire 2020, A Scalable and Production Ready Sky and Atmosphere Rendering Technique: https://diglib.eg.org/handle/10.1111/cgf14050 (PDF: https://diglib7.eg.org/bitstream/handle/10.1111/cgf14050/v39i4pp013-022.pdf)
- Hillaire, Frostbite sky/clouds (SIGGRAPH 2016): https://media.contentapi.ea.com/content/dam/eacom/frostbite/files/s2016_pbs_frostbite_sky_clouds.pdf
- Schneider and Vos, Horizon Zero Dawn clouds (2015): https://www.advances.realtimerendering.com/s2015/The%20Real-time%20Volumetric%20Cloudscapes%20of%20Horizon%20-%20Zero%20Dawn%20-%20ARTR.pdf
- Nubis Cubed (Advances 2023): https://advances.realtimerendering.com/s2023/Nubis%20Cubed%20(Advances%202023).pdf ; Nubis Evolved: https://www.guerrilla-games.com/read/nubis-evolved
- Cloud rendering/temporal reprojection paper: https://arxiv.org/pdf/1609.05344.pdf
- NLC visibility: https://rasc.ca/sites/default/files/Noctilucent_Clouds_2023.pdf ; https://mst.nerc.ac.uk/nlcs_where-and-when-can-they-be-seen.html ; https://link.springer.com/doi/10.1007/BF00173768 ; https://www.skyandtelescope.com/observing/nights-of-noctilucent-clouds/
- Aurora oval vs Kp: https://www.swsc-journal.org/articles/swsc/full_html/2022/01/swsc220003/F1.html (and a Kp-driven oval model abstract; only search snippets were read, not full texts)
- Epic Volumetric Cloud docs (spec R14): https://dev.epicgames.com/documentation/unreal-engine/volumetric-cloud-component-in-unreal-engine
- Existing repo reference: docs/reference/external-projects.md (takustaqu/atmosphere, MIT)

Caveat: web fetches were not performed; facts come from search result summaries, not full-paper reads. Verify numbers before an ADR cites them.

## Open questions

1. Should Phone tier ever get raymarched clouds, or is 2.5D the permanent ceiling? Needs a G-series Adreno 8xx profile of a 1/16-interleaved slab at 1/4 res.
2. Is the weather deterministic from seed for all players (shared world clock), or per-session? Affects save format and any multiplayer.
3. Real-date sync (actual season/day length at 62 N) or compressed game calendar? NLC and aurora seasonality depends on it.
4. Where does the surface-state system consume `precip`/`wetness` (CPU field vs shader uniform)? Confirm the `updateWetnessField` contract.
5. Real Hellesylt geomagnetic latitude (IGRF) and typical regional climate data (met.no normals) to tune frequencies; not yet sourced.
6. Do fjord walls occlude enough sky that crepuscular rays should be shadow-map-based rather than screen-space?
