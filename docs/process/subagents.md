# Subagents

How the orchestrating agent delegates work. Agent definitions live in `.claude/agents/`.

| Agent | Model / effort | Use for |
| --- | --- | --- |
| `wu-implementer` | Sonnet, medium (high for large specs) | One spec step from `docs/specs/` |
| `wu-fixer` | Haiku, low | Small mechanical edits a spec spells out |
| `wu-critic` | Sonnet, high; read-only | Render-only visual review ([visual review](visual-review.md)) |

Rules:

- **Several subagents at once use Haiku** (owner, 2026-11-18: "下次要派多個麻煩用haiku"). This covers parallel research fan-outs and batches of small tasks; pass `model: haiku` when spawning them. A single implementation step still uses `wu-implementer`.
- Every delegated task gets a written spec or prompt with scope, files, checks to run and the report format; subagents never push, approve or merge.
- Subagent reports are inputs, not evidence: the orchestrator re-runs the checks, reviews renders and states what was not verified.
