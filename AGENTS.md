# AGENTS.md

## Workflow: mdtask (spec-driven)

This repo uses [mdtask](https://github.com/syabro/mdtask). Specs live in
`docs/specs/` — prose on top describes what's built, checkbox tasks below are
the backlog. Follow the `mdtask` / `mdtask-next` / `mdtask-create` skills.

- Before changing behavior, read the relevant spec in `docs/specs/`.
- `mdtask list` shows open, unblocked tasks; work happens task-by-task.
- A task is done only when the code, its checkbox, and the spec prose are
  updated **in the same commit**. If your change alters behavior the spec
  describes, rewrite that prose to match.
- New work someone asks for becomes a task first (`mdtask-create`), then gets
  built.

## Conventions

- Commit messages are plain sentences in imperative mood, like the existing
  history ("Add search, and give the welcome screen room to breathe").
- The README is the user-facing manual; `docs/specs/` is the working reference.
  When they'd drift, update both.
