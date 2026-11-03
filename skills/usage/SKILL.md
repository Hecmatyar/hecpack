---
name: usage
description: Open a local page with the tokens and money Claude Code spent in this project, per model and per day, with the before/after around the day hecpack was set up. Built from the transcripts Claude Code already keeps, so nothing is collected during work and the project is not touched. Use when the user runs /hecpack:usage, asks how many tokens or how much money a project consumed, or wants to see usage by model over time.
argument-hint: "[--marker YYYY-MM-DD] [--lang en|ru]"
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

# hecpack usage

One command, no analysis by you:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/usage.mjs" --project "${CLAUDE_PROJECT_DIR}" --out "${CLAUDE_PLUGIN_DATA}/usage" --lang <lang> --open $ARGUMENTS
```

`<lang>` is `ru` when the user writes in Russian, else `en`. The script reads the project's transcripts under `~/.claude/projects` (parsed files are cached, so a later run reads only what changed), prices the tokens with `catalog/prices.json`, writes the page and `report.json` into the plugin's data folder and opens the page. The page has the period filter (7, 30, 90 days, all, before and after hecpack), the models in the legend (click to show one or several, All to reset), cost and tokens per day by model, the cumulative cost with the setup day marked, the before/after tiles and the per-model table.

Reply with the script's summary lines as they are (they are already in the user's language) and the page path. Add nothing else: no interpretation, no reading of the transcripts. The money is the API list price for the same tokens, a yardstick for subscription users, not an invoice; say so only if the user asks what the figures mean. If the script fails, show its error line and stop.

`--marker` overrides the setup day (by default the commit that added `.claude/hecpack/config.json`, else that file's date).
