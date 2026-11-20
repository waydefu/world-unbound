# Agent workflow, tools and environment

For any coding agent taking over WORLD UNBOUND (written at the handover from Claude to a GPT-based agent, 2026-11-19). [AGENTS.md](../../AGENTS.md) is binding and wins over this page. The owner writes in Traditional Chinese; reply in Traditional Chinese, conclusion first, state limits honestly.

## How a step is done

1. **Spec first.** Every feature step has a written spec in `docs/specs/` (why, ground rules, phases with exact files and numbers, checks, evidence, out of scope). The owner approves the plan in chat; quote the approval in the spec's status line. Architectural changes get an ADR in `docs/adr/`.
2. **Implement in phases, commit after each phase.** Sessions can be cut off (container restarts, usage limits); uncommitted work is lost. Keep module layers (`scripts/audit.mjs`): `world`, `perf`, `env` are pure; `render` may import world/perf/env/platform; `app` wires everything; files ≤ 350 lines; `@hot` / `@amortized` tags; no allocation in `@hot` paths.
3. **Never weaken checks.** Do not change existing test assertions, audit thresholds or snapshots to get green; list intentional baseline changes in the PR. Do not touch `governance/`, `.github/`, `scripts/` or `AGENTS.md` without a task-scoped owner authorisation.
4. **Render-only blind review** for anything visual ([visual review](visual-review.md)): render the six cameras (`tools/render.mjs`), give only the images to a reviewer that has not seen the code or spec (a separate agent/model run), fix P0/P1 findings or list them as deferred in the PR.
5. **Phone gate** (owner's Adreno 8xx, Chrome, WebGPU, med tier): after merge and deploy, the owner opens `/`, `?cam=3`, `?cam=2` (and A/B URLs such as `?terrain=chunks`, `?grass=0`), waits ~60 s and exports JSON. Pass = 60 FPS at render scale 1.0, no frame > 50 ms after warm-up. `gpu Σpass` is a sum of pass durations, not a frame time.
6. **PR:** follow `.github/pull_request_template.md` (Why / What / How tested / What could break / Who reviewed), `Refs #`, list tests not run, say that AI summaries are not CI proof. The owner merges; agents never approve or merge. After merge, confirm the Pages deploy actually ran (a red unit test in `pages.yml` skips the deploy) before giving the owner test URLs.

## Commands

```
npm ci --ignore-scripts
npm run dev                          # http://localhost:5173/world-unbound/
npm run check:quiet                  # lint, typecheck, tests, build, static audit, visual audit — one line per step
npm run check:quiet -- --no-visual   # skip the headless visual audit
taskset -c 0,1 node scripts/audit-visual.mjs --skip-build   # CI runs on 2 vCPUs: this must pass too

npm run build && npx vite preview --port 4174 &
node tools/render.mjs out/renders "cam0|cam=0" "cam5|cam=5" "cam2-med|cam=2&q=med"
node tools/hud-shot.mjs out/hud.png "cam=5&q=med"
taskset -c 0,1 node tools/probe-fps.mjs med        # informational (SwiftShader is not a GPU)
```

Output goes to `out/` (git-ignored). The page exposes `window.__wu.ready()` and `window.__wu.report()` (the telemetry JSON) for scripts.

## Environment requirements

- Node and npm (versions per `package.json` / CI); Chromium for Playwright (`npx playwright install chromium` if the environment has none). Headless rendering is WebGL2 on SwiftShader: slow, and WebGPU-specific results (render bundles, timestamps, vertex texture fetch performance) need the phone.
- Network: npm registry; `waydefu.github.io` to confirm deploys; Kartverket hosts only when re-baking terrain or fetching bathymetry.
- GitHub Codespaces: [docs/DEVELOPMENT.md](../DEVELOPMENT.md) configures Node 22 and installs `rg`, `fd`, `jq` on new containers. No heavy MCP, full dependency install, or Chromium download on startup.
- Optional search tools: `rg`, `fd`, `ast-grep`, `jq` — first locate with `git ls-files` or `fd -t f`, then `rg -n -F 'symbol' src tests`, then read only the matching function or line range. Search is not a substitute for checking call sites and tests.

## Saving tokens

- Prefer `npm run check:quiet` over raw tool output; read failing tails only. At the start of each new session, check the `main` HEAD and open Issues before trusting `HANDOFF.md`, and avoid repeating files already located by another subagent.
- **RTK** (Rust Token Killer, `rtk-ai/rtk`, tag `v1.2.0` exists) filters command output for agents (measured here: a 96 KB `git diff` became 32 KB; `git log --stat` unchanged). Install the official `rtk` package (prebuilt release, or `cargo install --git https://github.com/rtk-ai/rtk --tag v1.2.0 --locked rtk`); crates.io's `rtk` is a different project (Rust Type Kit). It supports Codex hooks. Verify with `rtk --version` / `rtk gain`, and make sure it does not hide failure details of the visual audit.
- Parallel research fan-outs: use a small, cheap model; one implementation step at a time with a stronger one.

## What is Claude-specific (ignore or replace)

- `.claude/agents/*.md` (role definitions for Claude subagents; the roles map to steps 2 and 4 above).
- `Co-Authored-By` / `Claude-Session` commit trailers: use your own tool's attribution rules.
- Paths like `/tmp/claude-0/.../scratchpad/` in older specs: use `out/`.
- Claude cloud environments, PR-activity subscriptions and scheduled check-ins: watch CI yourself or ask the owner.

## Where things are

[HANDOFF.md](../HANDOFF.md) (state, measurements, next steps, known issues) · [INDEX.md](../INDEX.md) (every document) · [architecture](../architecture/README.md) (layers, data flow) · [environment research](../research/environment-systems.md) (roadmap for weather, water, soil, ecology, audio) · specs in `docs/specs/`, decisions in `docs/adr/`.
