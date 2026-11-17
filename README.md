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

**Owner action after initial successful Actions run:** enable the existing protect-main Ruleset and select the exact required check for this workflow (final-gate). Do not turn on a Required Check before it has run successfully at least once.

## Roadmap

- **M0:** repository and governance skeleton (this commit)
- **M1:** protected base-policy evaluation, code/secret/dependency scanning and real tests
- **M2:** TS + Rust/Wasm + WGSL architecture, device integration, AI isolation
- **M3:** artifact integrity, environment/OIDC deployment gates, rollback
- **M4:** maintenance and metrics

Repository owner: [@waydefu](https://github.com/waydefu).
