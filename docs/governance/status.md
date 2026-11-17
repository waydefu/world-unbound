# Governance status

Snapshot: 2026-11-17. Source of truth for the rules: AEGIS ∞ v2.0 and [AGENTS.md](../../AGENTS.md). This page records where the project stands against them, what the owner decided and authorised, and what is still open. It is documentation; enforcement lives in GitHub settings, `governance/` and CI.

## Milestones

| Milestone | Status | Evidence |
| --- | --- | --- |
| M0 repository and governance skeleton | Complete | README "M0 owner actions"; negative test GH013 on 2026-11-17 |
| M1 trusted quality gate | Complete on the agent side; T20 not exercised; T01 unmet as a technical control | [m1.md](m1.md) |
| M2 AI isolation, architecture contracts, device regression | Not started. Partial groundwork: module layers enforced by `scripts/audit.mjs`, headless visual audit, telemetry export | [architecture](../architecture/README.md) |
| M3 artifact integrity, deployment gates, rollback | Not started. Pages deploys only from `main` via `pages.yml` | — |
| M4 maintenance and metrics | Not started | — |

## Owner decisions (2026-11-17)

| Decision | Record |
| --- | --- |
| WebGL2 is a flagged Lite tier, not parity | ADR-0002 §2 |
| Rust/Wasm only for build-time generation and bake | ADR-0002 §3 |
| Art direction: physically based light + curated materials | ADR-0002 §5 |
| Acceptance by real-town reference boards and blind review | ADR-0002 §7 |
| Stay on three.js; static geometry in render bundles | ADR-0002 §10, [engine spike](../spikes/engine-spike.md) |
| Ruleset requires CodeQL code scanning (High+ security, Errors) | [m1.md](m1.md) owner actions |
| Erosion bake deferred until after G1 (quality insufficient) | [terrain-erosion spike](../spikes/terrain-erosion.md) |
| Work order: G1 (light, materials, ocean) before the bake | Owner reply "照你建議" |

## Authorisations given to the coding agent

Each was scoped to one task and does not carry over (AGENTS.md: an authorisation in one context does not extend to the next).

| Scope | Owner's words | Used for |
| --- | --- | --- |
| `governance/` gaps during M0 | "我核准了" | M0 governance files |
| Game build incl. architecture | "我授權你直接改（含架構）" | G0, ADR-0002 |
| `.github` for G0 | "授權改 .github" | CI jobs, Pages |
| `.github` for M1 | "授權 M1 修改 .github" | PRs #8, #11 |
| G0.5 bake work | "授權，先確認品質才開始" | Erosion prototype (stopped at the quality check) |

G1 (PRs #13–#15) and the stop-work handoff needed no protected-path changes.

## Open gaps

| # | Gap | Why it is open | Who can close it |
| --- | --- | --- | --- |
| 1 | Deliberate CI weakening in a PR (T01) | Public personal repo: no push rulesets, no required workflows; `pull_request_target` blocked from 2026-12-02 | Platform; mitigated by owner review of `.github/` diffs |
| 2 | Independent two-person review | Single maintainer; required approvals are 0 | Owner (second maintainer) |
| 3 | T20 fork-PR CI without secrets not exercised | Needs a fork from a second account | Owner |
| 4 | `scripts/audit.mjs` and `scripts/audit-visual.mjs` produce CI evidence but are not sensitive paths | `governance/sensitive-paths.yml` lists `.github/scripts/**` (R3) only; an edit that weakens the audit is classified R0/R1 | Owner: add `scripts/**` (R3, "Validators that produce CI evidence") and `tests/**` (R2, "Assertions must not be weakened") to `governance/sensitive-paths.yml` |
| 5 | `src/env/**` (new in G1.1) has no owner domain | `governance/owners.yml` architecture domain predates it | Owner: add `src/env/**` to the architecture domain |
| 6 | No device regression path | Phone results are owner-run and uploaded by hand | M2 |
| 7 | `materialVariants` telemetry is a hard-coded 2 | Not wired to the renderer's pipeline cache | Agent (G1.3) |

Gaps 4 and 5 are edits to `governance/`, which agents may not make (AGENTS.md). They are listed here so the owner can apply them in one PR.

## Process conventions in use

- Work happens on the agent branch, one PR per milestone step, squash-merged by the owner. PR bodies follow `.github/pull_request_template.md`, use `Refs #`, and state that AI summaries are not verification evidence.
- Required check `final-gate` (5 jobs) plus CodeQL code scanning; `base-policy` stays advisory.
- Tests are extended, never weakened; baseline or snapshot changes are called out in the PR.
- Dependencies: versions released at least two weeks earlier; `npm ci --ignore-scripts`; actions pinned by full SHA; no caches in workflows.
