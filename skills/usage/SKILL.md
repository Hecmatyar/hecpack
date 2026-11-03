---
name: usage
description: Open a local page with the tokens and money Claude Code spent in this project, per model and per day, with the before/after around the day hecpack was set up. Built from the transcripts Claude Code already keeps: the first run counts the last 7 days, then a session-start hook adds new sessions in the background; the project is not touched and no model is called. Use when the user runs /hecpack:usage, asks how many tokens or how much money a project consumed, or wants to see usage by model over time.
argument-hint: "[--marker YYYY-MM-DD] [--history-days N|all] [--rebuild]"
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

# hecpack usage

## The page in the user's language

The page comes in the language the user writes in; for English skip this step. Otherwise, with `<lang>` the code of that language (`ru`, `de`, `pt-BR`):

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/i18n.mjs" --lang <lang> --dir "${CLAUDE_PLUGIN_DATA}/i18n" --pages usage
```

When `count` is above 0, translate every value of `missing`, short and plain, keeping each `{placeholder}` and the product, command and file names as they are (each key under `plurals` is one number category: write that grammatical form). Store them all in one call, then resend whatever comes back under `rejected`, fixed:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/i18n.mjs" --lang <lang> --dir "${CLAUDE_PLUGIN_DATA}/i18n" --merge <<'JSON'
{"usage.title": "...", ...}
JSON
```

The translation stays in the plugin's data folder: this happens once per language, and again only for strings a hecpack update adds or changes.

## Build and open

One command, no analysis by you (`--lang <lang>` drops out for English):

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/usage.mjs" --project "${CLAUDE_PROJECT_DIR}" --out "${CLAUDE_PLUGIN_DATA}/usage" --lang <lang> --open $ARGUMENTS
```

The script reads the project's transcripts under `~/.claude/projects` and keeps what it parsed in a store in the plugin's data folder. The first run in a project counts the last 7 days (`--rebuild --history-days N`, or `all`, for a longer window); every later run reads only the sessions that changed, and the store keeps the totals of transcripts Claude Code has deleted since (it removes them after a month). A hook at each session start runs the same count in the background, so the page is already current, in the language of the last run; this command mostly just opens it. Tokens are priced with `catalog/prices.json`.

The page has the period filter (7, 30, 90 days, all, before and after hecpack), the models in the legend (click to show one or several, All to reset), cost and tokens per day by model, the cumulative cost with the setup day marked, the before/after tiles and the per-model table. Its path stays the same, so the user can bookmark it and open it without Claude.

Retell the script's summary lines in the user's language, keeping the numbers as they are, and give the page path. Add nothing else: no interpretation, no reading of the transcripts. The money is the API list price for the same tokens, a yardstick for subscription users, not an invoice; say so only if the user asks what the figures mean. If the script fails, show its error line and stop.

`--marker` overrides the setup day (by default the commit that added `.claude/hecpack/config.json`, else that file's date). `--rebuild --history-days <N|all>` starts the count again with another window.
