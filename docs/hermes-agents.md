# Hermes agents — where the docs live

The Hermes agent deployment framework (`hermes-agent-framework.md`) and
per-agent runbooks (`hermes-agent-setup.md`, …) are **operator-distributed
standalone files, not stored in this repo** — the operator (Joel) keeps the
canonical copies and hand-supplies them to work sessions. Ask him for the
current versions. (Earlier revisions exist in this repo's git history on
branch `claude/hermes-cedar-grove-agent-c3zior`, but those are stale by
design.)

The agents themselves reference this repo only for the pure calculation
modules in `src/utils/*.mjs` (see the framework's data-alignment rule).
