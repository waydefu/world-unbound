# Environment systems — research overview

Status: research, not a decision (ADRs decide). Date: 2026-11-18. Requested by the owner. Five research notes, written by AI subagents from web sources, are in [env/](env/). Each note tags facts with sources and marks its own inferences. Figures marked *unverified* below must be checked before an ADR cites them.

| Note | Covers |
| --- | --- |
| [1 Fields and forces](env/1-fields-forces.md) | Environment field substrate, wind, buoyancy/drag/sails, rigid-body options, determinism |
| [2 Atmosphere and sky](env/2-atmosphere-sky.md) | Climate state and microclimate, clouds, precipitation, lightning, optical and astronomical phenomena at 62° N |
| [3 Hydrology and ocean](env/3-hydrology-ocean.md) | Tide, fetch-limited sea state, waves, wakes, bathymetry data, river and waterfall, reflections and refraction |
| [4 Ecology and numbers](env/4-ecology-numeric.md) | Vegetation placement and phenology, succession, fauna, resource stocks and flows |
| [5 Surface and acoustics](env/5-surface-acoustics.md) | Wetness, snow, frost, mud, footprints; procedural Web Audio, reverb, haptics, captions |

## One architecture for all of them

The five notes agree on a shape that ADR-0002 already points to:

1. **One CPU-authoritative state, sampled per frame.** A seeded `ClimateState` (pure function of seed and game time) produces the existing `Weather` label plus continuous drivers: cloud cover, precipitation rate, wind vector, temperature, humidity, tide level, season phase. It is published once per frame in the `EnvironmentSnapshot`.
2. **A few coarse fields, not a fluid sim.** Fields that vary in space live as small CPU grids in pure `src/env`/`src/world` and are uploaded as small textures: a camera-local wind texture (64², 10–20 Hz), a surface-state clipmap (wetness, snow, frost, mud; 2–5 Hz, ~0.5 MB), later a wake/ripple target. Static companions (fjord channelling, fetch per direction, drainage, sky view, vegetation mask) are baked once from the DTM. No GPU→CPU readback; gameplay reads the CPU copy.
3. **Determinism.** Fixed 60 Hz simulation tick; gameplay-visible values are pure functions of (seed, tick, weather state); render-only detail (gust noise, ripples) may use frame time. Save only slow state (stocks, accumulated snow), regenerate the rest.
4. **Consumers read, never own.** Materials, vegetation, ocean, audio, AI and economy read the snapshot and fields; only the env/world modules write them.

```
ClimateState (seed, time) ──► wind ──► grass sway, sails, waves (fetch), audio wind bed
        │                 ├─► clouds ─► sky/overcast, cloud shadows, ambient
        │                 ├─► precipitation ─► surface state (wet/snow/mud) ─► materials, footsteps, audio
        │                 └─► temperature ─► snow line, frost, breath, fauna activity
        ├─► tide ─► sea level ─► shore foam, piers, boats
        └─► season ─► phenology (leaf colour, snow), ecology stocks
GPU height/material textures (G2.0) ─► vegetation mask ─► grass, trees
```

## What it means for the roadmap (proposal)

Order chosen so that each step unblocks the next and stays inside the phone budget (G1.4.1: 60 FPS at 2.2 MP with headroom).

| Step | Content | Why now | Est. phone cost |
| --- | --- | --- | --- |
| G2.0 | CDLOD terrain from GPU textures (merged, #25) | Grass needs the height texture | ≤ today |
| **G2.1** | Phase 1: `ClimateState` v1 (wind vector, season, temperature) + wind field (weather vector × baked fjord channelling + gusts); phase 2: grass — vegetation mask baked next to the terrain textures, camera-centred hashed cells, wind sway, season colour (owner: wind and grass together) | **There is no wind in the code today**; the blind review flags a "smeared meadow" | wind < 0.3 ms GPU; grass to be measured |
| W1 | Layered 2.5D clouds (2–3 layers) + cloud shadows + fog layers (valley/sea fog, inversion) driven by `ClimateState` | Rain/overcast frames read wrong today | 0.3–0.8 ms + < 0.2 ms |
| W2 | Rain/snow particles + screen streaks + surface-state clipmap (wetness, puddles; snow later) + lightning | Makes weather visible and affects materials | 0.3–0.8 ms + ~0.1 ms |
| O1 | Tide clock (5 constituents), fetch-limited sea state from wind, Beer–Lambert water colour, caustics; bathymetry constrained by Kartverket 50 m soundings | Cheap, high payoff; fixes uniform shallows | 0.3–0.6 ms |
| A1 | Procedural Web Audio: AudioWorklet noise beds (wind, rain, surf, waterfall) driven by fields, ≤ 8 equal-power spatial voices, one fjord reverb | Game spec M3 audio | 1–3 % of one core |
| S1 | **Soil and ground system** (owner request 2026-11-18): baked static soil layer (type rock/sand/earth/peat/turf, depth, porosity, drainage, depressions — from the DTM and material weights); dynamic surface state on CPU at 2–5 Hz (moisture, puddle depth, mud, snow; rain runs into depressions, infiltrates by porosity, evaporates with sun and wind); player-centred deformation trail texture (~100 m) for footprints and tracks that recover over time per soil (sand fast, mud slow, snow medium). Visual only (normals, darkening, near-ring vertex offset); the authoritative height field is not changed. See note 5 | Needs a walking player and rain (W2) first | ~0.5 MB state textures; trail ~0.25 MB; ~0.2 ms |
| G3 | Ecology numbers (logistic stocks per region: wood, fish, hay, game) with the economy loop; trees placed on CPU near the player | Needed by gameplay, not by visuals | < 0.1 ms per day tick |
| Later | Boats (shared CPU/GPU wave function, buoyancy, wakes), river and waterfall hero asset, footprints, snow, fauna (gull boids first), aurora / noctilucent clouds / halos / Milky Way, raymarched clouds on desktop | Polish or gameplay-gated | per note |

## Decisions the owner needs to make (not now, when each step starts)

1. **Game spec §4.5 flora** lists Baltic species (beech, oak, dunes), which contradicts the 62° N Hellesylt setting (birch, pine, alder, heather). The spec is an owner document.
2. **`src/audio` module**: a new layer means changing `scripts/audit.mjs` (protected path) — needs owner authorisation when audio starts.
3. **Calendar**: real dates or a compressed year? It decides tide, season and aurora timing.
4. **Shared world**: is the weather seed shared between players?
5. **Rigid-body physics**: Rapier (wasm, documented cross-platform deterministic) only after an on-phone spike; no public mobile benchmark exists.

## Unverified figures (check before citing)

Treeline for Hellesylt (inferred 500–700 m); tidal range and harmonic constants at Sunnylvsfjorden (Kartverket tide API, Ålesund gauge exists); Hellesylt geomagnetic latitude (aurora frequency); noctilucent-cloud sun-depression window; HRTF cost and voice limits on phones; FFT ocean and Rapier timings; several shipped-game technique details (flagged in each note).

## Corrections to the notes

- Note 3 says the sea floor is 512² at 4 m; it is 1024² at 4 m plus a 2048² 2 m coast map (G1.4.1).
- Note 2 says the game spec has no section 13; it does (`### 13｜天空、大氣、體積雲、空氣透視與雲影`, around line 231, which contains the cloud API stubs the note cites). Read it alongside note 2 when the weather step starts.
