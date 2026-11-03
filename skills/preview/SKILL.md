---
name: preview
description: Show what hecpack would set up in this project without changing it. Detects the stack, recommends a level, finds rules and plugins for each technology, lists the rule documents already in the project, plans the files for the lite, standard and deep levels and opens a local page with the choices and diffs. Use when the user runs /hecpack:preview or asks what hecpack would do here.
argument-hint: "[--level lite|standard|deep] [--techs id,id] [--try]"
disable-model-invocation: true
allowed-tools: Bash(node:*), Read
---

# hecpack preview

A dry run of the hecpack setup. **Never write, move or delete anything in the project**: the script writes only into the plugin's data folder. Do not run `/init`, install plugins or edit `CLAUDE.md` from here, even if the page or the user's project suggests it; the page gives the user the commands to run themselves.

1. Run, from any folder:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/preview.mjs" --project "${CLAUDE_PROJECT_DIR}" --out "${CLAUDE_PLUGIN_DATA}/preview" --lang <lang> --open $ARGUMENTS
   ```

   `<lang>` is the code of the language the user writes in (`en`, `de`, ...); it only sets the reply language in the planned `config.json`, the page itself is in English. Without `--level` the recommended level is chosen. `--try` also clones the project's committed state into the data folder and writes the files of the chosen level there (uncommitted changes and `node_modules` are not in that copy).

2. The script prints a short summary and opens the page. Retell the summary in the user's language in a few lines: the technologies found, the recommended level and why, the files the level would write, the plugins worth installing, the warnings, and the page path (the user can open it again from there).

3. The summary also lists the rule documents already in the project. When there are any, read the ones under 300 lines (Read) and hecpack's core (`${CLAUDE_PLUGIN_ROOT}/core/session.md`, `workflow.md`) and add three or four lines: what the project's rules add that hecpack lacks (to carry over at `/hecpack:init`), and where they contradict hecpack (one line per conflict: the two rules and the trade-off). Longer documents: name them and say `/hecpack:init` goes through them in full. Change nothing.

4. If `--try` was given, tell the user to open a new Claude Code session in the sandbox folder the summary names to try the setup there.

End with one line: `/hecpack:init` sets the project up with the selection from the page (the page shows the exact command). If the script fails, show its error line and stop.
