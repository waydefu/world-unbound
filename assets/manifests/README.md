# Asset Manifests

Every binary game asset records file path, digest, source/provenance, license, encoding, and processing toolchain version here.

- [`terrain-hellesylt.json`](terrain-hellesylt.json): the 16 height tiles of the Hellesylt terrain (`assets/terrain/hellesylt/`), baked by `scripts/terrain/bake-hellesylt.mjs` from Kartverket DTM 1 m (CC BY 4.0, © Kartverket). The app verifies every tile's sha256 against this file before it starts.

The manifest and released asset bytes must match; this becomes a release gate in M3. Git LFS tracking is configured for source formats in [/.gitattributes](../../.gitattributes); the terrain tiles are small runtime files (each well under the 2 MiB limit) and stay in Git.
