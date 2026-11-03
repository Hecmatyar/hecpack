---
name: context
description: Open a local page with the context tree of this project, for each mode of the main session and each agent, showing what is loaded at start (Claude Code's own files, the hecpack hook, the agent body) and what it may read by link. It also lists the files that cost most, the rules by path, the docs nobody reads and the repeated text, with the change since the last run. A script builds it with no model call. Use when the user runs /hecpack:context or asks how much context an agent or mode starts with.
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

# hecpack context

One command, no analysis by you:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/context-tree.mjs" --project "${CLAUDE_PROJECT_DIR}" --out "${CLAUDE_PLUGIN_DATA}/context" --open $ARGUMENTS
```

The script reads the project's `.md` files, the context map (`.claude/hecpack/context-map.json`, or `.claude/context-map.json` in a setup of the same format), the agents, the rules and the auto memory index, and writes the page, `report.json` and a short history into the plugin's data folder. Nothing in the project changes.

The page lists, for each reader, what loads at start: CLAUDE.md files and their imports, rules without `paths:`, the memory index, the agent and skill lists, the hook's files for the prompt tag or the agent, and the agent's own instructions. Next to it is what those files link to, with the line that says when to read it. Then come the files that cost most at start (tokens times readers), every file with its readers, the rules that load by path, the docs nobody reaches, the pairs of files that repeat each other, and a warning where the hook's parts are too few for a reader's files. Tokens are characters / 4, an estimate.

Retell the script's summary lines in the user's language, keeping the numbers as they are, and give the page path. Add nothing unless the user asks what to trim; then name the top two or three rows of «what costs most» and the repeats, one line each, and change nothing. If the script fails, show its error line and stop.
