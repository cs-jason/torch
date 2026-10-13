---
name: torch-work
description: Do a Torch task end to end. Load its context, do the work, commit, and record the result in Torch. Use when the user says work on, do or start a task ID such as JC-010, or asks an agent to pick up the next task.
---

# Torch Work

Turn a task into finished, recorded work, without the user re-explaining anything.

## 1. Pick and load
- Use the ID the user gave. Otherwise take the top `next` task an agent can do (`torch task list --json`).
- Skip anything that needs the user's decision, approval, money, sending or publishing. Draft what helps, then stop.
- Read `torch help rules`, the project's AGENTS.md, `torch context <ID>`, and the files the task links to.
- You should be able to state **Why**, **Done** (and how to check it) and **Access**. If Done is unclear and a guess would waste the work, ask one question first.
- Take the task: `torch task update <ID> --revision <hash> --owner "<your agent name>"`.

## 2. Do it
Follow the project's AGENTS.md. Stay inside Done: note new ideas as follow-ups instead of building them. Verify against Done by running tests, checking the preview or reading back the output.

## 3. Commit and record
- **Code:** commit locally with a clear message. Push or open a pull request only when the user asked or the project's AGENTS.md says so.
- **Torch:** checkpoint with a fresh revision: `--note "Changed: … Evidence: … Next: …"`. Then set:
  - `done` when Done is met and verified;
  - owner = the user, with exactly what to look at, when it needs their review;
  - `next` or `waiting` with the blocker named, when unfinished.
- Update the task body to the new current state, and CONTEXT.md only if a project-level fact changed.

Report in three lines: what changed, where to check it (file, preview or pull request), and what's next.
