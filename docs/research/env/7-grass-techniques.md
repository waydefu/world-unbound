# Dense natural grass: techniques and numbers for a mobile WebGPU/TSL game

## Summary

The "planted rows" look comes from uniform placement, identical blades, and no spatial correlation. Shipped games break it with clumping (a shared clump owns height, facing, lean and colour), per-blade curvature and lean, and colour/height variation that is correlated over space (patches). Ghost of Tsushima's Voronoi clumps and Bezier blades are the reference, but I could only confirm them through secondary summaries; I did not read the GDC slides. I found no verified blades-per-m² figure for Ghost of Tsushima and no verified mobile blade budget. Mobile numbers below are from search snippets and need profiling on the Adreno 8xx target.

## Techniques

- **Ghost of Tsushima (Wohllaib, GDC 2021):** Blades are generated per tile, with tile data (clump factor, blade size, wind interaction) stored in 512x512 textures. Clumping is "controlled by a voronoi algorithm"; each blade picks its nearest clump point, which sets height, direction, colour and bend (secondary summary). Blades are cubic Bezier curves with fewer vertices far away (a secondary summary cites 15 near / 7 far; unverified). The vertex shader blends from dense to sparse meshes by distance. Distant terrain is blended toward grass-tip colour so culled grass still reads as dense. Animating blades costs "minimal performance loss (2ms)" on PS4-class hardware. Source: [Lucas Lab summary](https://lucaslabstudio.wordpress.com/2024/08/02/creating-realistic-vegetation-with-procedural-content-generation/); [talk listing](https://advances.realtimerendering.com/s2021/jpatry_advances2021/index.html); [GDCVault entry](https://gdcvault.com/play/1027033/Advanced-Graphics-Summit-Procedural-Grass) (cited by a secondary source, not opened).
- **GodotGrass (inspired by Ghost of Tsushima):** Clump factor from cellular noise groups the rotational offset, height and max bend of nearby blades. Procedural bend by height (independent of wind). Camera-facing blades stretched horizontally in view space. Normals bent horizontally in the fragment shader. Colour blends base-to-tip; AO darkens by height. Wind is scrolled Perlin plus high-frequency domain warp at tips. Source: [github.com/2Retr0/GodotGrass](https://github.com/2Retr0/GodotGrass).
- **Three.js WebGPU Grassworks:** Lower LODs remove blades but keep the survivors in the same positions. LOD transitions use spatial dithering. Billboards are used at distance. Color maps set colour by area. Reports "locked 60fps at 1440p on M1" after a rewrite from ~40fps. Source: [Grassworks thread](https://discourse.threejs.org/t/high-performance-grass-rendering-in-three-js-webgpu/94175); [migration thread](https://discourse.threejs.org/t/migrating-my-grass-system-to-webgpu-and-making-a-robust-grass-plugin/92893) (billboards "much more denser at very low cost"; tiling with per-blade frustum culling).
- **Instancing and indirect draw:** Common in three.js/Unity demos: InstancedMesh per tile, GPU-driven wind and deformation in the vertex shader. Source: [1M blades at 60fps thread](https://discourse.threejs.org/t/real-time-grass-simulation-in-the-browser-over-1-million-blades-at-60-fps/82808).
- **Not found:** A free, complete TSL grass-blade demo; a SimonDev "Quick Grass" tutorial (only his 2023 "How do Major Video Games Render Grass?" video, cited by GodotGrass); Acerola grass figures. Searches for SimonDev and Acerola returned nothing usable.

## Numbers

- Sucker Punch animated "over a million grass blades individually" (Lucas Lab summary, above).
- Desktop three.js demos: 1M+ blades at 60fps (thread above); 3M instanced grass optimisation thread: [discourse 81286](https://discourse.threejs.org/t/performance-optimizing-3m-instanced-grass-in-three-js/81286) (not opened).
- Mobile (search snippet only, not verified): Unity URP indirect instancing, ~10M grass instances, ~50–60 FPS on Adreno 612 at 125 draw distance, ~30 FPS on Adreno 506 at 75. Cost tracks visible instance count. Source: search result on [keaukraine's WebGL vegetation article](https://keaukraine.medium.com/efficient-webgl-vegetation-rendering-b09a7fa904cc) and the [Unity BRG sample](https://unity.com/blog/engine-platform/batchrenderergroup-sample-high-frame-rate-on-budget-devices).
- Draw calls are usually the mobile bottleneck, with a "under ~200" guideline (weak source). Low-end Android WebGL vegetation was vertex-shader bound.
- Blade cost: a naive blade is 6–10 triangles (Hashnode excerpt of Tiger Abrodi).
- Maxon C4D: 100% density ≈ 1 blade per 5 surface units (ambiguous units; not a real-time reference). Source: [Maxon help](https://help.maxon.net/c4d/2025/en-us/Content/html/MARCHIGRASS-ID_MATERIALPROPERTIES.html).
- Density via map: Jahrmann & Wimmer 2013 use a density texture (red channel) per 1x1 unit: [paper](https://www.cg.tuwien.ac.at/research/publications/2013/JAHRMANN-2013-IGR/JAHRMANN-2013-IGR-paper.pdf).

No verified blades/m² figure for Ghost of Tsushima or any shipped mobile title. For the 2–3 ms budget, the practical target is set by profiling a visible-instance count, not a published number.

## Rules to apply

1. Clump: Voronoi or cellular noise per tile; clump owns height, lean, facing and colour. Blades jitter around the clump centre.
2. Per blade: random yaw, a curved Bezier (2–3 segments), taper to a point, random lean and height within clump.
3. Colour: low-frequency noise for patches; base darkening via AO by height; base colour matched to terrain albedo near the root.
4. Density high enough near the camera that ground is hidden; fade with distance by dropping blades (keep survivors' positions) and dithering, not by shrinking all blades.
5. Mid distance: cards or billboards with the same material; terrain shader adds fine grass noise beyond the blade range, matching tip colour.
6. Normals: bend horizontally toward the root normal for rounder shading.
7. Budget: cap visible instances per frame; LOD by instance count; measure on Adreno 8xx before fixing density.

## Sources

- https://lucaslabstudio.wordpress.com/2024/08/02/creating-realistic-vegetation-with-procedural-content-generation/ (fetched; Ghost summary)
- https://advances.realtimerendering.com/s2021/jpatry_advances2021/index.html (fetched; talk listing only)
- https://gdcvault.com/play/1027033/Advanced-Graphics-Summit-Procedural-Grass (search result, not opened)
- https://github.com/2Retr0/GodotGrass (fetched)
- https://discourse.threejs.org/t/high-performance-grass-rendering-in-three-js-webgpu/94175 (fetched)
- https://discourse.threejs.org/t/migrating-my-grass-system-to-webgpu-and-making-a-robust-grass-plugin/92893 (fetched)
- https://discourse.threejs.org/t/real-time-grass-simulation-in-the-browser-over-1-million-blades-at-60-fps/82808 (search result)
- https://discourse.threejs.org/t/performance-optimizing-3m-instanced-grass-in-three-js/81286 (search result)
- https://tigerabrodi.blog/grass-in-ghost-of-tsushima (Hashnode excerpt, fetched)
- https://keaukraine.medium.com/efficient-webgl-vegetation-rendering-b09a7fa904cc (search result)
- https://unity.com/blog/engine-platform/batchrenderergroup-sample-high-frame-rate-on-budget-devices (search result)
- https://help.maxon.net/c4d/2025/en-us/Content/html/MARCHIGRASS-ID_MATERIALPROPERTIES.html (search result)
- https://www.cg.tuwien.ac.at/research/publications/2013/JAHRMANN-2013-IGR/JAHRMANN-2013-IGR-paper.pdf (search result)
- Not reachable: https://tympanus.net/codrops/2025/02/04/how-to-make-the-fluffiest-grass-with-three-js/ (403)
