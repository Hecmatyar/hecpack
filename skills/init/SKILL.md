---
name: init
description: Set hecpack up in this project through a short guided choice. Scans the stack, proposes a level and the plugins that fit, reads the rule documents the project already has and says what to carry over and what conflicts, then writes .claude/hecpack/ and one section in CLAUDE.md. Use when the user runs /hecpack:init or asks to set hecpack up here.
argument-hint: "[--level lite|standard|deep] [--techs id,id] [--yes]"
disable-model-invocation: true
allowed-tools: Bash(node:*), Read, Glob, Grep, AskUserQuestion, Edit, Write
---

# hecpack init

A guided setup in five short steps. The user picks; you do not decide for them, and you do not go deeper than they ask. Keep every message short: the choices, one line of reason each, your recommendation marked. Reply in the user's language; the files you write stay in English.

Nothing is written before step 4, and the only files written are the ones the plan lists. Never run `/init`, never install a plugin yourself (give the command), never touch `.claude/settings.json`, never delete or rewrite a project file: `CLAUDE.md` gets one section, the rest is new under `.claude/hecpack/`.

## 1. Scan

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/scan.mjs" --project "${CLAUDE_PROJECT_DIR}"
```

Read the JSON. If `claude.hecpack` is true, say that hecpack is already set up here and that this run will refresh the generated files while keeping edited ones; go on.

## 2. Ask: level and techs

One `AskUserQuestion` with these questions (skip a question the arguments already answer; `--yes` takes every recommendation without asking). hecpack sets no permissions and no git policy: those stay with the user's own environment and settings.

- **Level**: the three levels with one line each (`lite`: session rules, triage, stack and checks, the checker agent; `standard`: plus the architect loop and the thinker and the project map; `deep`: plus the chain of chats, sub-sessions with a coordinator and model limits per agent), the `recommended.level` marked with its `reason`.
- **Technologies**: multi-select of `techs`, all preselected; each with its version and where its rules would come from (`sources`). The user unticks what hecpack should ignore.

## 3. Go through the rules the project already has

`docs` lists the rule documents found (CLAUDE.md, AGENTS.md, Cursor or Copilot rules, `.claude/rules`, `.claude/docs`, contributor docs) with their headings and the hecpack topics each one touches. Read each one (Read; for a file over 400 lines read the sections whose headings touch a hecpack topic). Read hecpack's core rules once: `${CLAUDE_PLUGIN_ROOT}/core/session.md`, `workflow.md`, `coordination.md`.

Sort every rule you find into three groups, and report them as one compact list, grouped:

- **Already covered**: hecpack says the same (one line, no action).
- **To carry over**: a project rule hecpack has nothing on (stack specifics, folder rules, naming, a tool to run, a product rule). Proposal: keep the file where it is and load it with the code rules, that is pass it in `--rules`; a rule buried in a long file that mostly duplicates hecpack is better moved into a short new file `.claude/hecpack/rules/<topic>.md` (write it in step 4 with the user's yes, and list it in `--rules`).
- **Conflicts**: the project says one thing and hecpack's core another (the reply language, when to ask the user, triage or review steps, how reports look, git or dependency policy, which model does what). For each: the project's rule and hecpack's in one line each, then the advantage and the cost of each side in one line, then your pick. Put the conflicts to the user in one `AskUserQuestion` (one question per conflict, two options: keep the project's rule, take hecpack's; your pick as the first option). A kept project rule goes into `--rules` (or into `.claude/hecpack/rules/`); when hecpack wins, say which lines of which file the user may now delete; you do not delete them.

No documents found: say so in one line and go on.

## 4. Plan, confirm, write

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/init.mjs" --project "${CLAUDE_PROJECT_DIR}" --level <level> --techs <ids> --rules <paths> --lang <ru|en>
```

(`--lang` is the language the user writes in; drop an empty `--techs` or `--rules`.) Show the file list with its actions and the diff of every `update` (CLAUDE.md, an existing generated file). Files marked `kept` were edited since generation: tell the user and offer `--force` only if they want them regenerated. One confirmation (AskUserQuestion, or implied by `--yes`), then the same command with `--write`. Write the rule files from step 3 first, so `--rules` finds them.

## 5. Fill the project map and finish

At `standard` and `deep`, `.claude/hecpack/project-map.md` has an empty description per folder. Fill each line yourself from what the folder holds (its index or main files, its package.json description; one line per folder, what lives there, nothing else), with Edit. Skip a folder you cannot name in one line and leave its line empty.

Then report, in this order, about ten lines: the level and techs chosen; the agents now available (`agentModels` in the written config.json; name the designer when the stack has UI and the e2e runner when it has a suite, and when it has none, the one-line suggestion from `stack.md` § E2E); the files written; the project rules carried over and the conflicts settled; the install commands for `suggestedPlugins` the user wants (one per line, they run them); one line that `/hecpack:metrics` takes the first snapshot for a later comparison, and that `/hecpack:preview` shows the whole picture on a page. Everything loads by itself from the next prompt on; nothing to restart.
