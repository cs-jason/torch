---
name: torch-list
description: Say what's going on in Torch in plain English, covering what needs the user, what agents are doing and what's next. Read-only. Use when the user asks what's up, what needs me, what's going on with a project, or for a status or list.
---

# Torch List

Answer "what's up?" quickly. Never write records from this skill.

1. **Scope:** the project the user names, or the current folder's project. Otherwise use every active project: `torch projects --json`, then `torch context --project '<root>' --json` for each.
2. **Reply** in short groups, one line per task (ID, title, the one thing that matters), skipping empty groups:
   - **Needs you:** owned by the main owner, `next` or `waiting`. Name the decision or action needed.
   - **Agents working:** `next`, owned by an agent.
   - **Waiting on others:** `waiting`, owned by someone else, with what it waits on.
   - **Next up:** the three remaining `next` tasks that best serve the goal in CONTEXT.md.

   Don't list backlog unless asked.
3. **Stale records:** if a record looks out of date (a status that contradicts its checkpoints), say so in one line and suggest `torch-tidy` or `torch-work <ID>`.

End with one recommendation: the single task to do next, and why.
