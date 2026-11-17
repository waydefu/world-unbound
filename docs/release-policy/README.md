# Release Policy

No public game release is supported yet. The intent is declared in [governance/release-policy.yml](../../governance/release-policy.yml).

Before a first release:
- Document version semantics, compatibility and end-of-life support.
- Build release artifacts in a trusted workflow.
- Validate exact commit and artifact digest.
- Use the preconfigured production GitHub Environment with reviewer and branch protections where the account supports them.
- Exchange short-lived credentials using OIDC (or an equivalent approved solution) rather than storing permanent tokens.
- Document rollback and hotfix-backport evidence.
