# Threat Model

Initial threats include malicious fork PRs, unauthorized workflow edits, poisoned dependencies/caches, unsafe local actions, AI prompt injection, stale test evidence and accidental release credential disclosure.

Assets: source, branch authority, Actions workflow identity, dependency integrity, contributor data and future player saves.
Trust boundaries: untrusted PR -> CI, CI -> protected main, protected main -> production, AI context -> tool permissions.
Open item for M1: define attack trees, protected-base policy checks and repeatable negative tests.
