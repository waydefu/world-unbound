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

Once Pages is enabled, the site is served at https://waydefu.github.io/world-unbound/. Debug parameters: `?cam=0..5 &backend=webgpu|webgl2 &q=low|med|high &scale=0.5..1.5 &hour=0..24 &wx=clear|cloudy|rain|storm`. Press `H` or tap **HUD** for telemetry; **JSON** exports a report.

## Governance

- [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Code of Conduct](CODE_OF_CONDUCT.md)
- [AI Agent contract](AGENTS.md) · [Governance dictionaries](governance/)
- [Architecture and contracts](docs/) · [Open-source license](LICENSE)

The source of truth is AEGIS ∞ v2.0. Configuration files here are **declarations** until corresponding GitHub settings and protected CI checks enforce them.

## CI / main protection

On each push to main and each PR targeting main, CI runs four jobs (`m0-files`, `policy-syntax`, `app-checks`, `visual-audit`) and an unconditional `final-gate`. The final gate rejects failed, cancelled, skipped, and unknown prerequisite conclusions. The single Required Check stays `final-gate`.

Pushes to main also run `.github/workflows/pages.yml`, which rebuilds and re-verifies the merged commit and deploys it to GitHub Pages.

The first run on main succeeded on 2026-11-17 ([run 44000149061](https://github.com/waydefu/world-unbound/actions/runs/44000149061), commit `89b10bc`), so `final-gate` can now be selected as a Required Check.

### M0 owner actions (GitHub Settings; not performable by AI agents)

M0 is **not complete** until a human owner has done and checked the following:

- [ ] protect-main Ruleset is *Active*: require PR, block force-push and deletion, require status check `final-gate` with source *GitHub Actions*, require branches to be up to date, restrict bypass.
- [ ] Negative test: a direct push to main is rejected (record the output as evidence).
- [ ] Decide required approvals. With a single maintainer, a PR author cannot approve their own PR; requiring approvals or Code Owner review would block every owner-authored PR unless bypassed. Two-person control stays **unmet** either way.
- [x] Labels are synced from [governance/labels.yml](governance/labels.yml) by `.github/workflows/labels.yml` on every merged change to the dictionary. GitHub's default labels (`bug`, `wontfix`, ...) are kept; run the workflow manually with *prune* to remove them. Verify in the Actions tab after merge.
- [ ] Configure Issue Fields (Priority, Severity, Risk, Component, ...) and a Project whose automation maps PR merge to *Integrated*, not *Done*.
- [ ] Enable Private Vulnerability Reporting, Dependabot alerts, secret scanning and push protection.
- [ ] Enable GitHub Pages with source *GitHub Actions* (Settings → Pages) before the next merge to main, or the deploy job fails. Optionally restrict the `github-pages` environment to `main` and add yourself as a required reviewer.

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
