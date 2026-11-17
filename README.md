# WORLD UNBOUND

An open-source project starting from a verifiable GitHub governance baseline.

## Current status

- **Governance M0:** files in place; owner settings below still pending.
- **Game G0 (engine skeleton):** Vite + TypeScript + three.js WebGPURenderer (WebGL2 fallback), deterministic terrain and coastline, chunk streaming in a Worker, hysteresis dynamic resolution, telemetry HUD with JSON export, six fixed test cameras, static and headless audits. There is no gameplay, architecture, vegetation, real sky or ocean yet.

Not verified on any real device. Performance, thermal and WebGPU results must come from hardware tests.

## Run it

```
npm ci --ignore-scripts
npm run dev      # http://localhost:5173/world-unbound/
npm run check    # typecheck, tests, build, audits
```

Once the Pages workflow is applied and Pages is enabled, the site is served at https://waydefu.github.io/world-unbound/. Debug parameters: `?cam=0..5 &backend=webgpu|webgl2 &q=low|med|high &scale=0.5..1.5 &hour=0..24 &wx=clear|cloudy|rain|storm`. Press `H` or tap **HUD** for telemetry; **JSON** exports a report.

## Governance

- [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Code of Conduct](CODE_OF_CONDUCT.md)
- [AI Agent contract](AGENTS.md) · [Governance dictionaries](governance/)
- [Architecture and contracts](docs/) · [Open-source license](LICENSE)

The source of truth is AEGIS ∞ v2.0. Configuration files here are **declarations** until corresponding GitHub settings and protected CI checks enforce them.

## CI / main protection

On each push to main and each PR targeting main, CI runs two validation jobs and an unconditional final-gate. The final gate rejects failed, cancelled, skipped, and unknown prerequisite conclusions.

**CI does not yet build or test the game code, and nothing deploys to Pages.** Workflow files are human-maintained; the proposed `app-checks`, `visual-audit` and Pages deploy workflows are written out in [docs/runbooks/ci-and-pages-setup.md](docs/runbooks/ci-and-pages-setup.md) for the owner to review and apply. Until then, `npm run check` results are local evidence only.

The first run on main succeeded on 2026-11-17 ([run 44000149061](https://github.com/waydefu/world-unbound/actions/runs/44000149061), commit `89b10bc`), so `final-gate` can now be selected as a Required Check.

### M0 owner actions (GitHub Settings; not performable by AI agents)

M0 is **not complete** until a human owner has done and checked the following:

- [ ] protect-main Ruleset is *Active*: require PR, block force-push and deletion, require status check `final-gate` with source *GitHub Actions*, require branches to be up to date, restrict bypass.
- [ ] Negative test: a direct push to main is rejected (record the output as evidence).
- [ ] Decide required approvals. With a single maintainer, a PR author cannot approve their own PR; requiring approvals or Code Owner review would block every owner-authored PR unless bypassed. Two-person control stays **unmet** either way.
- [ ] Create the labels declared in [governance/labels.yml](governance/labels.yml) (none exist on GitHub yet; Issue Forms reference `needs/triage` and `impact/performance`).
- [ ] Configure Issue Fields (Priority, Severity, Risk, Component, ...) and a Project whose automation maps PR merge to *Integrated*, not *Done*.
- [ ] Enable Private Vulnerability Reporting, Dependabot alerts, secret scanning and push protection.
- [ ] Apply the CI and Pages workflows from [docs/runbooks/ci-and-pages-setup.md](docs/runbooks/ci-and-pages-setup.md), then enable GitHub Pages with source *GitHub Actions* (Settings → Pages).

## Roadmap

Governance milestones (AEGIS ∞ v2.0):

- **M0:** repository and governance skeleton (files in place; owner settings above pending)
- **M1:** protected base-policy evaluation, code/secret/dependency scanning
- **M2:** AI isolation, architecture contracts, device regression paths
- **M3:** artifact integrity, environment/OIDC deployment gates, rollback
- **M4:** maintenance and metrics

Game milestones (specification v1.0, renamed G0–G3 to avoid clashing with the above):

- **G0:** engine skeleton, authoritative terrain, telemetry baseline — implemented, device verification pending
- **G1:** atmosphere, PBR weathering materials, multi-band ocean
- **G2:** Hanseatic town architecture and period vegetation
- **G3:** gameplay loop, procedural audio, saves

Repository owner: [@waydefu](https://github.com/waydefu).
