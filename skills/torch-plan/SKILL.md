---
name: torch-plan
description: Turn a discussion or project goal into Torch tasks with owners and a recommended order. Separates selected work from future ideas. Use for roadmap planning, "plan the next steps", or reprioritizing.
---

# Torch Plan

The agent reasons about the plan; Torch stores it.

1. Read `torch help rules` (once per session), then `torch context`, then `torch task list --all --json`. Check archived tasks and merge destinations before adding anything.
2. Work out the goal now and the nearest useful outcome from the user's words and CONTEXT.md. The user's explicit priorities and postponements win.
3. Shape outcomes, not steps:
   - Update a matching task before adding one. Small steps go in the task's Steps list.
   - Each task body follows the rules: Why, Done, Access, Next.
   - Selected work is `next`. Future ideas and anything postponed is `backlog`.
   - Owner is whoever acts next. Priority is `high` only for the current goal or a real blocker.
4. If direction changed, update CONTEXT.md's **Goal now** and add a short recommended order. Keep the rest of CONTEXT.md intact.
5. If the user is only exploring or says not to change anything, show the plan without writing.

Report the task IDs added or changed, what's next versus backlog, the recommended order, and any decision only the user can make. A plan never authorizes doing the work.
