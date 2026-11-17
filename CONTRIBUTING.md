# Contributing to WORLD UNBOUND

Thanks for contributing. This repository is bootstrapping its architecture, so propose substantive features in an Issue before implementing them.

## Development workflow

1. Read [AGENTS.md](AGENTS.md), [SECURITY.md](SECURITY.md) and the relevant [contracts](docs/contracts/).
2. Open a Bug, Feature, Performance or Task Issue. Security vulnerabilities must use private reporting instead.
3. Work in a branch; do not force-push main.
4. Keep each PR focused and complete all five questions in the PR template.
5. Attach reproducible commands and observed results. Clearly mark tests that were not run.
6. Wait for required CI and human reviews; PR merge does not automatically mean the Issue is verified.

## M0 scope and tests

The first iteration consists of governance files only. Do not claim runtime game, performance, security, or license-compliance tests have been run without evidence. CI currently verifies repository structure and policy syntax, not future implementation behavior.

## Sensitive paths

Changes to .github/workflows/, .github/actions/, .github/CODEOWNERS, governance/, build hooks, dependency source configuration, and privileged tooling need explicit maintainer approval. AI agents must not modify governance/ or .github/workflows/; those changes are human-maintained.

## Licensing

Contributions are submitted under the repository's MIT License unless separately agreed in writing. Do not include code, shaders, media, or third-party assets unless you have permission and can record their provenance and license. The repository's MIT license does **not** automatically relicense third-party materials.

## Reports and conduct

Use [Issues](https://github.com/waydefu/world-unbound/issues) for public defects and [Private Vulnerability Reporting](SECURITY.md) for vulnerabilities. Follow the [Code of Conduct](CODE_OF_CONDUCT.md).
