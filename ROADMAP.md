# Roadmap

## Done

### v0.1

- Core rules, agents (architect, thinker, checker), hooks (context injection per task and agent, model limits, handoff after compaction).
- `/hecpack:preview`: stack detection, sources per technology (hecpack packs, marketplace plugins, context7, local-skill fallback), files for lite / standard / deep with diffs, a local page with selection and commands, `--try` sandbox clone. Checked on a real Nx + Expo + Next monorepo: 14 technologies, nx validation command, warnings about the project's own hooks and agents.

### v0.2

- `/hecpack:init`: a guided setup in one short round of questions (level with a recommendation from the stack, technologies), the plan with diffs before anything is written, edited generated files kept on a second run.
- Rule documents the project already has (CLAUDE.md, AGENTS.md, Cursor and Copilot rules, `.claude/rules`, `.claude/docs`, contributor docs) are found and tagged by topic; `/init` reads them, carries over what hecpack lacks (loaded with the core through `--rules`), and puts each conflict to the user with the trade-off.
- `/hecpack:metrics`: snapshots of code shape and commit rhythm, stored in the plugin's data folder, with the before/after table.
- Agents by stack: `hecpack:designer` (the project's design system and docs first, a proposal when there are none) with a UI technology, `hecpack:e2e-runner` with an e2e suite; `stack.md` § E2E carries the commands or the suggestion to add a suite; `[design]` and `[e2e]` prompt tags and the Design and E2E sections of the workflow.
- `/hecpack:usage`: tokens and money per model and per day from the Claude Code transcripts, on a local page with period and model filters and the before/after around the hecpack setup day; the first run counts the last 7 days, then a SessionStart hook adds new sessions in the background into a store in the data folder that keeps the totals of transcripts Claude Code has deleted; prices in `catalog/prices.json`.
- `/hecpack:context`: the context tree per mode and agent (start vs by link, with the «when to read» line), the files that cost most at start, rules by path, orphans, repeated text, hook part overflow and the change since the last run; works on hecpack's context map and on the Wayfarer-format `.claude/context-map.json`.
- Coordinator without Claude Projects: the session the task came to takes the role when splitting pays (standard and deep code sessions carry the rule), subagents first, background sessions in worktrees for long pieces, limits and permissions respected; reports in `tmp/handoff/<piece>.report.md`; `/hecpack:coord` shows the state in one call.
- Audit of what is installed, at `/preview` and `/init`: plugins (recorded installs, cache, synced from the account; disabled ones listed and left out), the user's and the project's skills, agents, commands, hooks and MCP servers; clashes, overlaps and works-together between them and with hecpack, each item with its file; `/init` compares each clash and recommends what to keep, `--without designer|e2e-runner` leaves hecpack's optional agents out (recorded in config.json, refused by the agent-model hook).
- Pages in the user's language: the strings live in `scripts/i18n/en.json`; the skill has the model translate what a language lacks once (`scripts/i18n.mjs` checks keys and placeholders, keeps plural forms per `Intl.PluralRules`, marks strings whose English changed), the translation stays in the data folder and the usage store remembers the language for the background hook; numbers, dates and money follow the language.
- From Wayfarer's efficiency metrics: the usage page has the cost of a working hour (model time plus tool runs, waits for the user left out, subagents by their own activity) and of a prompt, sessions, compactions, subagent runs, and the cost by stage of the work, by context size and by agent; the store moved to version 3 and carries a version 2 store over. A SubagentStop hook sends a designer report without its `Checklist: checked` line back once. The context hook has 8 parts (about 20k tokens of rules) instead of 4. Core rules took the review scope, the moved-files list, the fresh-reviewer rule, the thinker's no-think-longer rule, the model switch between chats and the wrap-up and report sizes.
- v0.3.0: the code rules from Wayfarer, generic: `core/code.md` (changes, style, structure, UI, errors, tests) for code sessions and the architect; validation in the workflow; search, reading, library docs by installed version and others' uncommitted changes in the session rules; compact instructions in the CLAUDE.md section. Every commit bumps the version from here on.
- `/hecpack:init` and `/hecpack:preview` run with `model: best` (Fable where available, else Opus) for their turn.
- The preview page shows the recommended level, the rule documents found and the exact `/hecpack:init` command for the selection. Optional modules are wired through (`--modules`, the page) but none ships yet: hecpack sets no permissions and no git policy, those come from the user's environment.

## Next

1. **Local skills for gaps**: `/init` writes `.claude/skills/<tech>/SKILL.md` for a technology with no pack or plugin, from the installed version's docs (context7) and the project's own code.
2. **First stack packs** as separate plugins in this marketplace: `expo-ios-hig` (platform file pairs, HIG checklist, designer agent, render-performance checklist), `nx-monorepo` (layered libs, arch-check script, safe move script). A `format-hooks` module (prettier on every edit, as in Wayfarer) when prettier is detected.
3. **Enabled plugins**: the page misses plugins enabled outside settings files (for example by the desktop app); find a reliable source.
4. **Benchmark**: `claude plugin eval` with `--ablation with-without` on a few tasks (triage line present, architect called on M, checker used for validation, rules loaded after compaction); cost and turns with and without the plugin. `/hecpack:metrics` on the real projects over a month.
5. **Weekly efficiency check** (opt-in, as in Wayfarer): a scheduled run of the usage numbers against a baseline week, with a journal of process changes and their measured effect in the project's memory.
6. **Publishing**: README with a screenshot and the eval numbers, submission to the Anthropic plugin directory, a short post.

## Open questions

- Whether `core/` should stay one set for all levels or split per level.
- Whether metrics snapshots should live in the project (`.claude/hecpack/metrics/`) so a team shares them; today they stay in the plugin's data folder so the project is never touched.
