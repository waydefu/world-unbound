# Ecology and numerical layer (research for G2 and later)

## Summary
- Placement should be a pure, deterministic function of baked terrain layers plus a hashed per-cell seed. It should run on the GPU for grass and in `src/world` (CPU/worker) for trees and anything gameplay can touch.
- The treeline for Hellesylt is unverified. Sources show ~850–1050 m in SW Norway and "lower in the west". My inference for coastal Sunnmøre is mountain birch ~500–700 m, with no sourced figure. Make it a tunable `treelineM` constant and check it against NIBIO/Artsdatabanken data.
- Spec 4.5 lists Baltic beech/oak/sand-dune flora. That contradicts the 62° N Hellesylt setting (birch, pine, alder, heather, meadow). Spec 4.5 needs a human-owned correction.
- Gameplay should read ecology only through a small pure-TS "stocks and flows" layer (wood, fish, hay, game). It uses fixed-timestep logistic models per region and a seeded PRNG. This is cheap (<0.1 ms/day-tick) and unit-testable.
- G2 needs only: static ecotope weights, grass density from the height texture, and a phenology uniform. Everything dynamic (succession, fauna, population) comes later.

## Recommendations
1. **G2 now**
   - Bake a `VegetationMask` (RGBA8) per chunk next to the height texture: R = meadow/grass weight, G = heath/moss, B = tree-density (CPU-only), A = bare/rock. Derive it from height, slope, aspect and a baked wetness/soil-depth proxy, plus a coastal-distance term.
   - Grass is a camera-centred cell grid. Each blade is hashed from (cellId, index), so nothing is stored per blade. Density is multiplied by the mask and by a distance fade, as in the Grassworks and Duskward notes in `external-projects.md`.
   - Add one `EnvironmentSnapshot.season` scalar (0–1 year phase) for phenology (see Details), and a `snowLine` scalar.
   - Put the species-rule table in `src/world/ecotopes.ts` as pure data plus pure functions, tested with vitest. Tests cover determinism (same seed gives the same output), monotone treeline behaviour, and slope cutoffs.
2. **G3 (alongside farming and fishing)**
   - Add `src/world/ecology/` with `stocks.ts`, `logistic.ts`, `rng.ts` and `regions.ts`. State is SoA `Float32Array`s indexed by region id, with a coarse region grid of about 100–250 m cells.
   - Tree instances come from a CPU placement pass (jittered Poisson-disc or blue-noise by hashed cell) within about 300 m of the player. Farther out is statistical (density per region, impostor).
3. **Later (after the loop is playable)**
   - Fauna boids for gulls only, with far-field fish as a shader or statistical effect, and deer as sparse agents.
   - Succession (meadow to birch scrub) updates at day or season granularity.
4. **Do not do:** per-plant growth simulation across the world, full Lotka–Volterra webs, or GPU readback for gameplay.

## Details

### 1. Placement and phenology
Facts (see Sources):
- Horizon Zero Dawn: placement is data-driven, deterministic and locally stable, with ecotopes that drive assets, colour, weather and wildlife. Data is ~32 bits per m², with 500+ asset types and ~250 objects placed per frame while moving [S1].
- The treeline in south-central Norway is ~1300 m. It is lower in the north and west. Examples in SW Norway are mountain birch at ~850–1050 m [S2].

Inference (not verified for Hellesylt):
- Mountain birch (*Betula pubescens* ssp. *czerepanovii*) forms the treeline. A coastal Sunnmøre fjord at 62° N with cool summers and strong maritime wind plausibly puts it at 500–700 m, so the 500–800 m band in the brief is a reasonable prior.
- Scots pine is not sourced for this fjord. Spruce on the west coast is largely planted and was not native in the medieval period, so I would exclude it or use it only sparsely.
- Alder and grey alder go in wet valley bottoms, with rowan, bird cherry and juniper in the scrub layer. Heather, crowberry, bilberry and moss cover thin soils. Hay meadows (*slåttemark*) go near farms.

Species rule per species (data row): elevation min/max, slope max, aspect preference (south slopes favoured for pine and farms), wetness range, soil-depth min, coastal exposure tolerance, and a competitive rank for ordering.

Algorithm (pure):
```
elev_f = smoothstep(treeline+50, treeline-150, h) // birch thins into krummholz
weights = normalize(rule_i(h, slope, aspect, wet, soil, distToFarm))
density = weights[i] * baseDensity[i] * (1 - grazingPressure)
instance = hash(cellId, speciesId, k) < density -> position jitter from the same hash
```

Phenology (a function of `season` plus an altitude lag of about 3–4 days per 100 m, inferred):
- Leaf-out for birch is mid-to-late May. Autumn colour peaks in late September to early October. First snow on the high ground is October, and the snow line drops through the winter.
- Implement it as a few uniforms: `leafAmount`, `autumnTint` and `snowCover`, plus per-species phase offsets. Do not bake it per season. The altitude lag is cheap in the shader.

### 2. Growth, succession and simulation LOD
- Three tiers by distance:
  - Near (0–150 m): individual objects with state (age bucket, felled flag), updated rarely and driven by player actions.
  - Mid: per-cell density fields updated by day.
  - Far: per-region statistics, updated by season.
- Succession can be modelled as a region-level Markov or logistic transition: meadow cover decays to scrub then to birch forest unless grazed or mown. Rate scales with the grazing pressure and mowing stocks of that region. Felling creates a cleared mask (a small delta layer) that regrows on a multi-year timescale.
- Store player-caused deltas as sparse lists (felled tree ids, mown cells) over the deterministic base, so a save stores only deltas. This is the same idea as Horizon's local stability: the base is regenerable.
- Cost (inference): 1000 regions × 6 stocks × one logistic step per game day is trivial (<0.05 ms).

### 3. Fauna
- Gulls and eagles: boids with separation, alignment and cohesion in 3D. A flock of 20–40 near the harbour is cheap on the CPU (O(n²) at n=40 is about 1600 pair checks), and a spatial hash lets this scale. Far flocks are a single point with a shader animation. Gulls are diurnal and gather near the harbour and fish cleaning. Eagles circle thermals over ridges.
- Fish: the fishing loop in spec 5.1 only needs a catch table with weights by season, time of day and depth. The visible school can be a shader particle effect near the lure and does not need to be agent-based.
- Deer: a handful of agents with a simple state machine (graze, flee, rest), spawned in forest-edge cells at dawn and dusk. Livestock (sheep, cows, goats) are tied to farm pens and pasture regions, and are visible only within about 150 m. Their grazing feeds the grazing-pressure scalar of the region.
- Day and night: store an activity curve per species as a function of `timeOfDay`. Spawning and despawning use hashed cell + day so the same cell yields the same animal.

### 4. Numerical layer
- Model: logistic growth per stock, `dN = r·N·(1 − N/K)·dt − harvest`, with fixed timestep (e.g. 1 game hour or day), explicit Euler, and clamped to [0, K].
  - wood: K from forest density in the region, r small (decades).
  - fish: K from depth and season, r moderate, with harvest from player and NPC catch.
  - hay: seasonal growth to a cutting date, then reset.
  - game (deer): logistic with a harvest term, and optional predation as Lotka–Volterra only if the quest needs it.
- Data layout: SoA `Float32Array` per stock and `Uint16Array` for region ids. All state is in one `EcologyState` object that serialises as typed arrays plus a version number.
- Determinism: integer-seeded PRNG (e.g. mulberry32 or PCG), with the seed derived from (worldSeed, regionId, tick). No `Math.random`, and no wall-clock time.
- How gameplay reads it: a read-only query API, e.g. `getStock(region, kind)` and `getPrice(kind)`. The market derives prices from scarcity ratio `N/K`. Quests subscribe to thresholds ("hay below 30%", "fish run started"). The sim publishes snapshots from the sim worker (ADR 0002), and the renderer never mutates ecology.
- Testing: pure TS in `src/world`, vitest golden tests (run N ticks, compare a checksum), property tests (stocks stay in [0, K], harvest never goes negative), and a determinism test that runs twice and compares bytes.
- Save: versioned schema, deltas only (stocks, felled/mown deltas, tick counter, RNG state). This fits the spec 5.1 IndexedDB checkpoint design.

### 5. Shipped examples (from memory, not verified in this session)
- Horizon Zero Dawn: GPU placement with ecotopes, as cited above [S1].
- RDR2, Banished, Farthest Frontier, Ecosystem (game), and Equilibrium-style sims are not fetched here. Treat the following as inference: Banished-style games use simple per-resource stocks with a seasonal cycle rather than a full food web, which is what I recommend here. Check each before citing.

## Sources
- [S1] Guerrilla Games, "GPU-Based Run-Time Procedural Placement in Horizon Zero Dawn" (GDC 2017): https://www.guerrilla-games.com/media/News/Files/GDC2017_VanMuijden_GPUBasedProceduralPlacementInHorizonZeroDawn.pdf (via search summary; the PDF itself was not opened) and https://www.gdcvault.com/play/1024120/GPU-Based-Run-Time-Procedural
- [S2] Treeline in Norway (search results only, no page opened): https://link.springer.com/content/pdf/10.1007/s10980-018-0670-8.pdf and https://www.nina.no/Portals/NINA/Bilder%20og%20dokumenter/PDF%202022/Mountain%20birch.pdf
- Repo: docs/reference/game-spec-v1.md (sections 4.5, 5.1, 16), docs/reference/external-projects.md, docs/adr/0002-target-architecture.md.

## Open questions
- What is the actual treeline above Hellesylt? Needs a regional source (NIBIO, Artsdatabanken, Kartverket) or DEM-plus-land-cover inspection.
- Should spec 4.5 be amended from Baltic flora to western-Norway flora? This needs a human owner, since the docs are governed.
- Is spruce excluded for the medieval period (my assumption)?
- Which game-time scale applies (one real hour to one game day?). This drives the ecology tick rate.
- Should hay and fish prices be fully ecology-driven, or have a designer-set floor to keep the loop stable?
- Shipped-game claims (RDR2, Banished, Farthest Frontier) were not verified; fetch sources before they go in docs.
