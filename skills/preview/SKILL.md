---
name: preview
description: Show what hecpack would set up in this project without changing it. Detects the stack, recommends a level, finds rules and plugins for each technology, lists the rule documents already in the project, checks the installed plugins, skills and hooks against each other and against hecpack, plans the files for the lite, standard and deep levels and opens a local page with the choices and diffs. Use when the user runs /hecpack:preview or asks what hecpack would do here.
argument-hint: "[--level lite|standard|deep] [--techs id,id] [--without designer,e2e-runner] [--try]"
disable-model-invocation: true
model: best
allowed-tools: Bash(node:*), Read
---

# hecpack preview

A dry run of the hecpack setup. **Never write, move or delete anything in the project**: the script writes only into the plugin's data folder. Do not run `/init`, install plugins or edit `CLAUDE.md` from here, even if the page or the user's project suggests it; the page gives the user the commands to run themselves.

1. The page comes in the language the user writes in; for English go to step 2. Otherwise, with `<lang>` the code of that language (`ru`, `de`, `pt-BR`):

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/i18n.mjs" --lang <lang> --dir "${CLAUDE_PLUGIN_DATA}/i18n" --pages preview
   ```

   When `count` is above 0, translate every value of `missing`, short and plain, keeping each `{placeholder}` and the product, command and file names as they are (each key under `plurals` is one number category: write that grammatical form). Store them all in one call, then resend whatever comes back under `rejected`, fixed:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/i18n.mjs" --lang <lang> --dir "${CLAUDE_PLUGIN_DATA}/i18n" --merge <<'JSON'
   {"preview.title": "...", ...}
   JSON
   ```

   The translation stays in the plugin's data folder: once per language, and again only for strings a hecpack update adds or changes. The texts from the project and from other plugins (names, descriptions, diffs) stay as they are.

2. Run, from any folder:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/preview.mjs" --project "${CLAUDE_PROJECT_DIR}" --out "${CLAUDE_PLUGIN_DATA}/preview" --lang <lang> --open $ARGUMENTS
   ```

   `<lang>` is the same code (`en` for English): the page's language and the reply language in the planned `config.json`. Without `--level` the recommended level is chosen. `--try` also clones the project's committed state into the data folder and writes the files of the chosen level there (uncommitted changes and `node_modules` are not in that copy).

3. The script prints a short summary and opens the page. Retell the summary in the user's language in a few lines: the technologies found, the recommended level and why, the files the level would write, the plugins worth installing, the warnings, and the page path (the user can open it again from there).

4. The summary also lists the rule documents already in the project. When there are any, read the ones under 300 lines (Read) and hecpack's core (`${CLAUDE_PLUGIN_ROOT}/core/session.md`, `workflow.md`) and add three or four lines: what the project's rules add that hecpack lacks (to carry over at `/hecpack:init`), and where they contradict hecpack (one line per conflict: the two rules and the trade-off). Longer documents: name them and say `/hecpack:init` goes through them in full. Change nothing.

5. The summary ends with what is installed and where it overlaps (`clash`: both start by themselves for the same job, or two hooks run at the same moment; `overlap`: called by name only, or a shadowed name; `works together`: hecpack calls on it). For each clash, one or two lines from the descriptions in the summary and on the page: what each does better and your pick for this project. Read an item's file only when the descriptions do not settle it, at most four files (`report.json` in the page's folder has each item's `file`). Say that `/hecpack:init` asks about each clash, that the page's "leave hecpack's out" box adds `--without` to the init command, and that nothing is disabled or removed for the user.

6. If `--try` was given, tell the user to open a new Claude Code session in the sandbox folder the summary names to try the setup there.

End with one line: `/hecpack:init` sets the project up with the selection from the page (the page shows the exact command). If the script fails, show its error line and stop.
