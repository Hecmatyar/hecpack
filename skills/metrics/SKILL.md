---
name: metrics
description: Take a snapshot of the project's metrics (size, tests, big files, TODOs, commit rhythm, fix share) and compare it with the previous snapshot. Stored outside the project, so nothing in it changes. Use when the user runs /hecpack:metrics, asks for project metrics, or wants to see what changed since hecpack was set up.
argument-hint: "[--days 30] [--compare]"
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

# hecpack metrics

One command, read-only for the project:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/metrics.mjs" --project "${CLAUDE_PROJECT_DIR}" --out "${CLAUDE_PLUGIN_DATA}/metrics" $ARGUMENTS
```

It measures the code (source and test files and lines, median file length, files over 300 lines, TODO/FIXME), the git history of the last `--days` (commits, authors, lines, lines and files per commit, the share of fix commits, reverts, the most changed files) and the Claude setup, saves the snapshot under the plugin's data folder and, when an earlier snapshot exists, prints the comparison table.

Retell the output in the user's language in a few lines: the headline numbers, and with a comparison the rows that moved and what the movement suggests (smaller commits and a lower fix share after hecpack was set up are the signals it is meant to move; more tests per source file too). Do not interpret a single snapshot beyond its numbers, and do not read the project to explain them unless asked. If the script fails, show its error line and stop.

A first snapshot right after `/hecpack:init` is the baseline; suggest the next run after two or three weeks of use.
