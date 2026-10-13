---
name: torch-start
description: Set up Torch for a project folder, or confirm it is already set up, and write a one-page CONTEXT.md. Use when the user says start Torch, set up Torch, or track this project in Torch.
---

# Torch Start

1. Run `torch context` here. If it finds a project, report its name, code and open task count, then stop. A linked code or notes folder counts as set up.
2. If the project already has a task home elsewhere (check `torch projects`), link this folder instead of making a second board: `torch link '<task home>' .`. Never create a board at a vault or workspace root, or for a folder the user's instructions exclude.
3. Otherwise run `torch init . --name "<Project name>"`. If `torch owner` is not the user, ask once and set it.
4. Write `.torch/CONTEXT.md`, at most one page, from the folder's README, AGENTS.md and current notes:
   - **What this is:** one or two sentences.
   - **Goal now:** the nearest useful outcome.
   - **Current state:** what works and what doesn't.
   - **Decisions:** settled choices agents must not reopen.
   - **Sources:** the few files that matter.

   Write only what the sources support. List unknowns as one-line questions for the user.
5. Add no tasks unless the user named them. Planning is `torch-plan`.

Report in three lines: the project and its code, the task home path, and what CONTEXT.md now says.
