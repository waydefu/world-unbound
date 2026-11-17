# Emergency / Break-glass Runbook

M0 has no autonomous bypass role. A human maintainer must explicitly authorize any emergency exception.

1. Identify Incident ID, affected environment, impact and reason.
2. Record actor, scope, issue link, source revision and expiration.
3. Choose the narrowest intervention; retain required release evidence when possible.
4. Restore default protections promptly, rotate exposed credentials if necessary.
5. Obtain independent post-review where a second human owner exists, target within 24 hours; record any unmet two-person control explicitly.
6. Perform postmortem within the target 72-hour window (internal target, not a platform guarantee).
7. If a release branch received a hotfix, bring an equivalent fix and regression test back into main before normal subsequent releases.

This is a policy/runbook; no automatic release blocker or bypass automation exists at M0.
