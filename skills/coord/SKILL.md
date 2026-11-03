---
name: coord
description: Show the state of the pieces this session coordinates in one call - the briefs and reports in tmp/handoff/, the background sessions Claude Code runs for the project, and the git worktrees. Use when coordinating sub-sessions or background sessions (hecpack core, «Sub-sessions and the coordinator»), before merging their work, or when the user runs /hecpack:coord or asks how the parallel pieces are doing.
allowed-tools: Bash(node:*)
---

# hecpack coord

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/coord.mjs" --project "${CLAUDE_PROJECT_DIR}"
```

One line per piece: its brief, its background session and status, its worktree, and its report status (`done`, `partial`, `blocked`, read from the report's first line). Background sessions or worktrees with no brief are listed after the pieces. Read-only.

Use it instead of reading the briefs and reports one by one. Read a report in full only when its piece is `done` and about to be merged, or `blocked` and needs an answer. When the user ran the command, retell the table in their language in a few lines: what is done, what is still running, and what waits on them.
