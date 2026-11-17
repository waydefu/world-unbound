# CI and GitHub Pages setup (owner action)

Status: **proposed, not applied.** AI agents may not edit `.github/workflows/` or the CI validator, so these changes are written out for the owner to review and commit. Action SHAs were read with `git ls-remote` on 2026-11-17; re-check them against the action repositories before use. None of this YAML has run on GitHub.

## 1. Add two jobs to `.github/workflows/ci.yml`

Insert before `final-gate`:

```yaml
  app-checks:
    name: app-checks
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
      - name: Checkout untrusted source for no-secret validation
        uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
        with:
          persist-credentials: false
      - name: Set up pinned Node.js
        uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version-file: .nvmrc
      - run: npm ci --ignore-scripts
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
      - run: npm run audit

  visual-audit:
    name: visual-audit
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    steps:
      - name: Checkout untrusted source for no-secret validation
        uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
        with:
          persist-credentials: false
      - name: Set up pinned Node.js
        uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version-file: .nvmrc
      - run: npm ci --ignore-scripts
      - run: npx playwright install --with-deps chromium
      - run: npm run audit:visual
      - name: Upload screenshots and telemetry for human review
        if: ${{ always() }}
        uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
        with:
          name: visual-audit
          path: artifacts/visual/
          retention-days: 14
```

Then, in the same file:

- `final-gate` → `needs: [m0-files, policy-syntax, app-checks, visual-audit]`
- in the gate script → `expected = {"m0-files", "policy-syntax", "app-checks", "visual-audit"}`

And in `.github/scripts/validate_m0.py`, make the gate self-test use the same four job names (its `good` dictionary currently lists two), otherwise `m0-files` fails with "unexpected job set".

The Required Check in the Ruleset stays `final-gate`.

## 2. Create `.github/workflows/pages.yml`

```yaml
name: Deploy / GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: pages-production
  cancel-in-progress: false

jobs:
  build:
    name: pages-build
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
        with:
          persist-credentials: false
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version-file: .nvmrc
      - run: npm ci --ignore-scripts
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
      - run: npm run audit
      - name: Record release digests
        run: find dist -type f -print0 | sort -z | xargs -0 sha256sum
      - uses: actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9 # v5.0.0
        with:
          path: dist

  deploy:
    name: pages-deploy
    if: ${{ github.ref == 'refs/heads/main' }}
    needs: build
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    permissions:
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@368f82528645a54fb793d4d04e342629a3f51346 # v5.0.1
```

## 3. Settings

1. Settings → Pages → Source: **GitHub Actions**. Do this before the workflow first runs, or the deploy job fails.
2. Optional: Settings → Environments → `github-pages` → restrict to `main` and add yourself as required reviewer if each publish should wait for approval.

## Design notes

- No dependency cache is restored and lifecycle scripts are disabled, so a pull request cannot influence a release build through a cache or an install hook.
- Only `pages-deploy` holds `pages: write` and `id-token: write`; the build job is read-only.
- Deployments are serialised and never cancelled mid-flight.
- The release build repeats typecheck, tests and the static audit on the merged commit rather than trusting pull-request results.
