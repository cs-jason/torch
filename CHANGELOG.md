# Changelog

## 1.0.0

First public release.

- **Local dashboard:** `torch dashboard` opens a browser view of every project and task on `127.0.0.1`. Nothing else can reach it.
- **Plain files:** each project keeps a `.torch/` folder with a one-page `CONTEXT.md` and a Markdown file per task. Commit it with your code or keep it local.
- **CLI:** `torch`, `torch needs`, `torch <project>`, `torch <task ID>`, `torch context`, `torch task …` and `torch doctor`.
- **Statuses:** `next`, `waiting`, `backlog` and `done`. "Needs you" means you own the task.
- **Skills for agents:** `torch-start`, `torch-list`, `torch-plan`, `torch-work` and `torch-tidy`, for Claude Code and Codex (`torch skills install`).
- **Lean records:** task bodies over 500 words and checkpoints over 150 are refused; `torch doctor` flags oversized records.
- **Safety:** writes that look like a credential are refused. `torch init --public` adds a GitHub check for public repositories.
