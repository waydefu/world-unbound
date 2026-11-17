# WORLD UNBOUND

An open-source project starting from a verifiable GitHub governance baseline.

**Picking up the work?** Read [docs/HANDOFF.md](docs/HANDOFF.md), then [docs/INDEX.md](docs/INDEX.md).

## Current status

- **Governance M0:** complete on 2026-11-17 (negative test passed). Independent two-person review remains an unmet control.
- **Governance M1:** complete on the agent side ([status](docs/governance/status.md)).
- **Game G0 (engine skeleton):** Vite + TypeScript + three.js WebGPURenderer (WebGL2 fallback), chunk streaming in a Worker, hysteresis dynamic resolution, telemetry HUD with JSON export, six fixed test cameras, static and headless audits.
- **Game G1 (in progress):** physical sky and atmosphere, calendar and ephemeris, auto-exposure, cascaded sun shadows, terrain in render bundles. No buildings, vegetation, real ocean or gameplay yet.

Partly verified on the owner's phone (engine spike, GPU ramp); shadows not yet. Performance, thermal and WebGPU results must come from hardware tests.

## Run it

```
npm ci --ignore-scripts
npm run dev      # http://localhost:5173/world-unbound/
npm run check    # typecheck, tests, build, audits
```

Once Pages is enabled, the site is served at https://waydefu.github.io/world-unbound/. Debug parameters: `?cam=0..5 &backend=webgpu|webgl2 &q=low|med|high &scale=0.5..1.5 &hour=0..24 &day=0..32 &wx=clear|cloudy|rain|storm &shadows=0`. Press `H` or tap **HUD** for telemetry; **JSON** exports a report.

## Credits

- **Terrain:** © Kartverket, [Nasjonal høydemodell (NHM) DTM 1 m](https://www.kartverket.no/en/api-and-data/terms-of-use), licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Modified: resampled to 2 m, quantised to 2 cm, seabed synthesised. The baked tiles and their digests are listed in [assets/manifests/terrain-hellesylt.json](assets/manifests/terrain-hellesylt.json); the pipeline is [scripts/terrain/bake-hellesylt.mjs](scripts/terrain/bake-hellesylt.mjs). The boot screen and the HUD show "Terrain © Kartverket (CC BY 4.0), modified".

## Governance

- [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Code of Conduct](CODE_OF_CONDUCT.md)
- [AI Agent contract](AGENTS.md) · [Governance dictionaries](governance/)
- [Architecture and module layers](docs/architecture/README.md) · [Governance status](docs/governance/status.md) · [Index](docs/INDEX.md) · [Open-source license](LICENSE)

The source of truth is AEGIS ∞ v2.0. Configuration files here are **declarations** until corresponding GitHub settings and protected CI checks enforce them.

## CI / main protection

On each push to main and each PR targeting main, CI runs `m0-files`, `policy-syntax`, `app-checks`, `visual-audit`, `dependency-review`, an advisory `base-policy`, and an unconditional `final-gate` over the first five; CodeQL code scanning is also required by the ruleset ([M1](docs/governance/m1.md)). The final gate rejects failed, cancelled, skipped, and unknown prerequisite conclusions. The single Required Check stays `final-gate`.

Pushes to main also run `.github/workflows/pages.yml`, which rebuilds and re-verifies the merged commit and deploys it to GitHub Pages.

The first run on main succeeded on 2026-11-17 ([run 44000149061](https://github.com/waydefu/world-unbound/actions/runs/44000149061), commit `89b10bc`), so `final-gate` can now be selected as a Required Check.

### M0 owner actions (GitHub Settings; not performable by AI agents)

Settings below were applied by the owner and read back on 2026-11-17 (owner-reported; agents cannot read repository settings here). **M0 is complete.**

- [x] protect-main Ruleset *Active*: PR required with 0 approvals, stale approvals dismissed, conversation resolution, squash only, required check `final-gate` (source GitHub Actions) with strict up-to-date, force-push and deletion blocked, empty bypass list.
- [x] **Negative test (2026-11-17, run by the owner):** a direct push of an empty commit to main was rejected:

  ```
  remote: error: GH013: Repository rule violations
  - Changes must be made through a pull request.
  - Required status check "final-gate" is expected.
  ! [remote rejected] HEAD -> main
  ```

- [x] Labels synced from [governance/labels.yml](governance/labels.yml) by `.github/workflows/labels.yml`. GitHub's default labels (`bug`, `wontfix`, ...) are kept; run the workflow manually with *prune* to remove them.
- [x] Issue Fields (Priority, Severity, Risk, Component, ...) pinned to Bug / Feature / Task. Impact and Verification Owner not created yet.
- [x] Project *WORLD UNBOUND · Engineering*: AEGIS statuses incl. Blocked / Needs Evidence / Not Planned; auto-add `is:issue,pr is:open`; item added → Submitted, PR merged → Integrated, item reopened → Triage, item closed → Resolved.
- [x] Auto-close of Issues by merged PRs is **off**, so a merge never skips Verified. PRs use `Refs #`.
- [x] Private vulnerability reporting, dependency graph, Dependabot alerts and security updates, secret scanning with push protection, CodeQL default setup.
- [x] Actions: only waydefu- and GitHub-authored actions, full-SHA pinning required, read-only default token, Actions cannot create or approve PRs, approval required for all external contributors' fork workflows.
- [x] General: squash merging only, update-branch suggestion on, head branches deleted after merge, wiki off.
- [x] Pages from GitHub Actions; `github-pages` environment limited to `main`.

**Known gap:** with one maintainer, independent two-person review is **not satisfied**; required approvals are 0 so the owner can merge their own PRs. CI (`final-gate`) is the merge gate.

## Roadmap

Governance milestones (AEGIS ∞ v2.0):

- **M0:** repository and governance skeleton — complete
- **M1:** complete on the agent side — base-policy re-validation (advisory), risk tiers, dependency review, exception checks, cache ban, lint, negative-test regression suite; deliberate CI edits remain an unmet control ([status and limits](docs/governance/m1.md))
- **M2:** AI isolation, architecture contracts, device regression paths
- **M3:** artifact integrity, environment/OIDC deployment gates, rollback
- **M4:** maintenance and metrics

Game milestones (specification v1.0, renamed G0–G3 to avoid clashing with the above):

- **G0:** engine skeleton, authoritative terrain, telemetry baseline — implemented, device verification pending
- **G0.5:** engine spike done — three.js stays, render bundles mandatory for static geometry ([results](docs/spikes/engine-spike.md)); erosion prototype not yet good enough, deferred until after G1 ([findings](docs/spikes/terrain-erosion.md)); build-time bake pipeline (eroded terrain), shared environment and query contracts, worker skeletons, telemetry fixes — see [ADR-0002](docs/adr/0002-target-architecture.md)
- **G1:** atmosphere, PBR weathering materials, multi-band ocean
  - G1.0 GPU load ramp (spike page) to measure headroom before effects
  - G1.1 physical sky and atmosphere: 32-day calendar at 62.083° N (Hellesylt since G1.5), sun/moon ephemeris, Hillaire 2020 transmittance / multiple-scattering / sky-view tables (CPU, identical on WebGPU and WebGL2), CIE overcast cloud deck, aerial-perspective fog, auto-exposure with pre-exposure; `?day=0..32` (default 6)
  - G1.2 cascaded sun shadows (2-3 cascades per tier, `?shadows=0` for A/B) and main-app terrain in a render bundle on WebGPU
  - G1.5 real terrain: the 4 km square around Hellesylt, Norway, baked from Kartverket's 1 m DTM into 16 committed height tiles (`assets/terrain/hellesylt/`, manifest in `assets/manifests/`), streamed at 2 m; seabed synthesised; sun at 62.083° N ([spec](docs/specs/g1.5-real-terrain.md))
- **G2:** Hanseatic town architecture and period vegetation
- **G3:** gameplay loop, procedural audio, saves

Repository owner: [@waydefu](https://github.com/waydefu).
