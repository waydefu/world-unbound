# CI Trust Boundaries (M0)

| Source | Trust tier | Secret access | Intended execution |
| --- | --- | --- | --- |
| Public fork PR | Untrusted | None | Disposable validation runner |
| Branch PR from collaborator | Untrusted until reviewed | None | Disposable validation runner |
| Protected main | Trusted source subject to enforced rules | Minimal | Build and verification |
| Protected production environment | High trust | OIDC or equivalent short-lived credential | Approved release only |

CI jobs have contents:read and do not use production secrets or fork-triggered privileged workflows. Application jobs install with `npm ci --ignore-scripts` and restore no dependency cache.

The Pages workflow runs only for main (and manual dispatch, which cannot deploy from another ref). It rebuilds and re-verifies the merged commit instead of reusing any PR artifact, records SHA-256 digests of the release files, and gives pages:write and id-token:write to the deploy job alone through the `github-pages` environment. Deployments are serialised and never cancelled mid-flight.

The final-gate checks exact prerequisite job IDs and requires each conclusion to be success. The M0 validator runs from the PR head, so it **cannot** by itself prevent malicious workflow edits. M1 must enforce protected base-policy verification and enable protect-main Ruleset after the first verified run.

Do not use untrusted local actions inside privileged workflow_run/pull_request_target processes, nor inherit all secrets into high-trust reusable workflows. Do not restore untrusted caches into releases.

The label sync workflow runs only from main (merged dictionary changes or manual dispatch). Its single job holds `issues: write`, reads the dictionary from the checked-out default branch, and never deletes labels unless the dispatching maintainer selects *prune*. API errors fail the job instead of being skipped.

## M1 additions

- `base-policy` (pull requests, advisory) re-runs the **protected base commit's** validator and risk classifier against the pull request. Base files are read with `git show` and executed with `python3 -I`; nothing from the pull request runs with more privilege than in its own CI. It catches accidental weakening of validator rules, but it is defined in the pull request's own workflow file, so a pull request that edits `.github/workflows/` can remove it. See [governance/m1.md](governance/m1.md) for why `pull_request_target` and push rulesets are not available as stronger anchors here.
- `dependency-review` (pull requests) blocks new dependencies with high or critical advisories or licences outside the allow-list. It uses the GitHub API with the job's read-only token and fails on API errors.
- No workflow may restore or save caches (AEGIS A01); the validator enforces this.

