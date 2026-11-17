# Contributing to WORLD UNBOUND

Thanks for contributing. This repository is bootstrapping its architecture, so propose substantive features in an Issue before implementing them.

## Development workflow

1. Read [AGENTS.md](AGENTS.md), [SECURITY.md](SECURITY.md) and the relevant [contracts](docs/contracts/).
2. Open a Bug, Feature, Performance or Task Issue. Security vulnerabilities must use private reporting instead.
3. Work in a branch; do not force-push main.
4. Keep each PR focused and complete all five questions in the PR template.
5. Attach reproducible commands and observed results. Clearly mark tests that were not run.
6. Wait for required CI and human reviews; PR merge does not automatically mean the Issue is verified.

## Local development

Node 22 (see `.nvmrc`).

```
npm ci --ignore-scripts
npm run dev            # http://localhost:5173/world-unbound/
npm run check          # typecheck, unit tests, build, static audit, six-camera headless sweep
```

`npm run audit:visual` needs a Chromium for Playwright (`npx playwright install chromium`). Debug URL parameters: `?cam=0..5`, `?backend=webgpu|webgl2`, `?q=low|med|high`, `?scale=0.5..1.5`, `?hour=0..24`, `?wx=clear|cloudy|rain|storm`, `?hud=0`.

Source files stay under 350 lines. Functions on the frame path are tagged `@hot` and must not allocate; budgeted or low-frequency work called from them is tagged `@amortized`. `src/world` and `src/perf` must not import three.js or touch the DOM.

## Scope of evidence

CI currently verifies repository structure and policy syntax only. Types, unit tests, the production build, the static audit and the headless WebGL2 sweep run locally through `npm run check` until the owner applies the proposed CI jobs. Nothing here measures device performance, thermals, memory or WebGPU rendering; do not claim those without measurements from real hardware.

## Sensitive paths

Changes to .github/workflows/, .github/actions/, .github/CODEOWNERS, governance/, build hooks, dependency source configuration, and privileged tooling need explicit maintainer approval. AI agents must not modify governance/ or .github/workflows/; those changes are human-maintained.

## Licensing

Contributions are submitted under the repository's MIT License unless separately agreed in writing. Do not include code, shaders, media, or third-party assets unless you have permission and can record their provenance and license. The repository's MIT license does **not** automatically relicense third-party materials.

## Reports and conduct

Use [Issues](https://github.com/waydefu/world-unbound/issues) for public defects and [Private Vulnerability Reporting](SECURITY.md) for vulnerabilities. Follow the [Code of Conduct](CODE_OF_CONDUCT.md).
