---
name: init
description: Set hecpack up in this project through a short guided choice. Scans the stack, proposes a level and the plugins that fit, reads the rule documents the project already has and says what to carry over and what conflicts, checks the installed plugins, skills, agents and hooks against each other and against hecpack and recommends what to keep, then writes .claude/hecpack/ and one section in CLAUDE.md. Use when the user runs /hecpack:init or asks to set hecpack up here.
argument-hint: "[--level lite|standard|deep] [--techs id,id] [--without designer,e2e-runner] [--yes]"
disable-model-invocation: true
model: best
allowed-tools: Bash(node:*), Read, Glob, Grep, AskUserQuestion, Edit, Write
---

# hecpack init

A guided setup in six short steps. The user picks; you do not decide for them, and you do not go deeper than they ask. Keep every message short: the choices, one line of reason each, your recommendation marked. Reply in the user's language; the files you write stay in English.

Nothing is written before step 5, and the only files written are the ones the plan lists. Never run `/init`, never install, disable or uninstall a plugin yourself (give the command), never touch `.claude/settings.json`, never delete or rewrite a project file: `CLAUDE.md` gets one section, the rest is new under `.claude/hecpack/`.

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

`docs` lists the rule documents found (CLAUDE.md, AGENTS.md, Cursor or Copilot rules, `.claude/rules`, `.claude/docs`, contributor docs) with their headings and the hecpack topics each one touches. Read each one (Read; for a file over 400 lines read the sections whose headings touch a hecpack topic). Read hecpack's core rules once: `${CLAUDE_PLUGIN_ROOT}/core/session.md`, `workflow.md`, `code.md`, `coordination.md`.

Sort every rule you find into three groups, and report them as one compact list, grouped:

- **Already covered**: hecpack says the same (one line, no action).
- **To carry over**: a project rule hecpack has nothing on (stack specifics, folder rules, naming, a tool to run, a product rule). Proposal: keep the file where it is and load it with the code rules, that is pass it in `--rules`; a rule buried in a long file that mostly duplicates hecpack is better moved into a short new file `.claude/hecpack/rules/<topic>.md` (write it in step 5 with the user's yes, and list it in `--rules`).
- **Conflicts**: the project says one thing and hecpack's core another (the reply language, when to ask the user, triage or review steps, how reports look, git or dependency policy, which model does what). For each: the project's rule and hecpack's in one line each, then the advantage and the cost of each side in one line, then your pick. Put the conflicts to the user in one `AskUserQuestion` (one question per conflict, two options: keep the project's rule, take hecpack's; your pick as the first option). A kept project rule goes into `--rules` (or into `.claude/hecpack/rules/`); when hecpack wins, say which lines of which file the user may now delete; you do not delete them.

No documents found: say so in one line and go on.

## 4. Go through what is already installed

`audit` lists the installed plugins (`enabled` false is off), the user's and the project's own skills, agents, commands and hooks, and `conflicts`. Each conflict has a `kind` (`role`: the same job; `hook`: hooks on the moment hecpack injects its rules or checks agent calls; `name`: the same bare name twice; `mcp`: one server from two sources), a `severity` (`clash`: both can start by themselves, so the model may pick either for the same task, or both hooks run; `overlap`: they run only when called by name, or a name is shadowed; `together`: hecpack calls on the other one, nothing to choose) and its `items`, each with its `file`.

No conflicts: one line, go on. Otherwise, for each `clash` and each `overlap` with hecpack, read the items' files (a SKILL.md, an agent or command file, the hook's settings or script; at most the first 120 lines each) and compare them on what they actually do: what each covers that the other does not, how well each fits this stack, how each starts (by itself or by name), and what it costs (a hook or an always-on skill costs tokens on every prompt; one called by name costs nothing until used). Report each conflict in three or four lines: one line per item, then your pick for this project with the reason, which may be a split when each is better at a part. Overlaps without hecpack and `together` get one line each, no question.

Put the clashes to the user in one `AskUserQuestion` (one question per clash, at most four; your pick first). What each answer does:

- **hecpack's designer or e2e runner gives way**: pass `--without designer` (or `e2e-runner`) in step 5; config.json records it and hecpack's agent-model hook refuses calls to it, so the other plugin does that job.
- **Another plugin gives way**: give `claude plugin disable <name>` for the user to run, and say what else that plugin brings (`plugins[].counts`), since the whole plugin goes off. A user or project skill, agent or command: name its file, which the user may move or delete; you do not.
- **Both stay, each with a part**: one line per split in `.claude/hecpack/rules/coexist.md` (written in step 5, listed in `--rules`), such as `Design: hecpack:designer makes the boards and variants; expo-design-system sets up the tokens in code.`
- **hecpack's checker, architect or thinker**: they carry the level and cannot be left out. When the user prefers another reviewer or planner, offer the split, or the lite level, which has no architect.
- **Two hooks on the same moment**: read what the other one injects. The same rules as hecpack's: keep one source and point the user to the file to edit. Different content: both stay; say the token cost.

## 5. Plan, confirm, write

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/init.mjs" --project "${CLAUDE_PROJECT_DIR}" --level <level> --techs <ids> --rules <paths> --without <agents> --lang <code>
```

(`--lang` is the code of the language the user writes in, such as `en` or `de`, saved as the reply language in `config.json`; drop an empty `--techs`, `--rules` or `--without`.) Show the file list with its actions and the diff of every `update` (CLAUDE.md, an existing generated file). Files marked `kept` were edited since generation: tell the user and offer `--force` only if they want them regenerated. One confirmation (AskUserQuestion, or implied by `--yes`), then the same command with `--write`. Write the rule files from steps 3 and 4 first, so `--rules` finds them.

## 6. Fill the project map and finish

At `standard` and `deep`, `.claude/hecpack/project-map.md` has an empty description per folder. Fill each line yourself from what the folder holds (its index or main files, its package.json description; one line per folder, what lives there, nothing else), with Edit. Skip a folder you cannot name in one line and leave its line empty.

Then report, in this order, about ten lines: the level and techs chosen; the agents now available (`agentModels` in the written config.json; name the designer when the stack has UI and the e2e runner when it has a suite, and when it has none, the one-line suggestion from `stack.md` § E2E); the files written; the project rules carried over and the conflicts settled; what was decided about the installed plugins and the commands left for the user; the install commands for `suggestedPlugins` the user wants (one per line, they run them); one line that `/hecpack:metrics` takes the first snapshot for a later comparison, that `/hecpack:usage` shows tokens and money per model with the last 7 days as the before (counted in the background from the next session start on), and that `/hecpack:preview` shows the whole picture on a page. Everything loads by itself from the next prompt on; nothing to restart.
