# WORLD UNBOUND

An open-source project starting from a verifiable GitHub governance baseline.

## Current status

**M0: bootstrap governance only.** This repository currently establishes policy documents, contribution templates, ownership, and an initial CI gate. It does not yet include a playable game, verified renderer, or production release.

## Governance

- [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Code of Conduct](CODE_OF_CONDUCT.md)
- [AI Agent contract](AGENTS.md) · [Governance dictionaries](governance/)
- [Architecture and contracts](docs/) · [Open-source license](LICENSE)

The source of truth is AEGIS ∞ v2.0. Configuration files here are **declarations** until corresponding GitHub settings and protected CI checks enforce them.

## CI / main protection

On each push to main and each PR targeting main, the M0 CI runs two validation jobs and an unconditional final-gate. The final gate rejects failed, cancelled, skipped, and unknown prerequisite conclusions.

The first run on main succeeded on 2026-11-17 ([run 44000149061](https://github.com/waydefu/world-unbound/actions/runs/44000149061), commit `89b10bc`), so `final-gate` can now be selected as a Required Check.

### M0 owner actions (GitHub Settings; not performable by AI agents)

M0 is **not complete** until a human owner has done and checked the following:

- [ ] protect-main Ruleset is *Active*: require PR, block force-push and deletion, require status check `final-gate` with source *GitHub Actions*, require branches to be up to date, restrict bypass.
- [ ] Negative test: a direct push to main is rejected (record the output as evidence).
- [ ] Decide required approvals. With a single maintainer, a PR author cannot approve their own PR; requiring approvals or Code Owner review would block every owner-authored PR unless bypassed. Two-person control stays **unmet** either way.
- [ ] Create the labels declared in [governance/labels.yml](governance/labels.yml) (none exist on GitHub yet; Issue Forms reference `needs/triage` and `impact/performance`).
- [ ] Configure Issue Fields (Priority, Severity, Risk, Component, ...) and a Project whose automation maps PR merge to *Integrated*, not *Done*.
- [ ] Enable Private Vulnerability Reporting, Dependabot alerts, secret scanning and push protection.

## Roadmap

- **M0:** repository and governance skeleton (files in place; owner settings above pending)
- **M1:** protected base-policy evaluation, code/secret/dependency scanning and real tests
- **M2:** TS + Rust/Wasm + WGSL architecture, device integration, AI isolation
- **M3:** artifact integrity, environment/OIDC deployment gates, rollback
- **M4:** maintenance and metrics

Repository owner: [@waydefu](https://github.com/waydefu).
