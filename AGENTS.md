# Torch

A local task tracker over plain-file records: a CLI, a local dashboard and five agent skills. Everything stays on the user's machine. Do not add network calls, telemetry, accounts or sync. The dashboard listens on `127.0.0.1` only.

Dependencies: `yaml` for records, `marked` and `sanitize-html` for the dashboard's Markdown. Do not add a dependency for what a few lines can do.

Task Markdown is the source of truth. Preserve user text, unknown metadata, IDs and checkpoints. Validate every write, refuse stale revisions, and keep 0.x status values readable. The CLI and the dashboard read and write the same files.

Rules for agents live in one place, `torch help rules` (src/help.mjs). Skills, the `.torch/README.md` guide (src/onboarding.mjs) and AGENTS.md blocks point to it instead of repeating it. Keep each skill under about 500 words.

Run `bun run test` after changes. Tests must use a temporary TORCH_HOME, CODEX_HOME and CLAUDE_CONFIG_DIR, never real records or skills. State what was and wasn't verified.
