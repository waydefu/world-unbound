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
