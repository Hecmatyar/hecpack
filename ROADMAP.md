# Roadmap

## Done

### v0.1

- Core rules, agents (architect, thinker, checker), hooks (context injection per task and agent, model limits, handoff after compaction).
- `/hecpack:preview`: stack detection, sources per technology (hecpack packs, marketplace plugins, context7, local-skill fallback), files for lite / standard / deep with diffs, a local page with selection and commands, `--try` sandbox clone. Checked on a real Nx + Expo + Next monorepo: 14 technologies, nx validation command, warnings about the project's own hooks and agents.

### v0.2

- `/hecpack:init`: a guided setup in one short round of questions (level with a recommendation from the stack, technologies, optional modules), the plan with diffs before anything is written, edited generated files kept on a second run.
- Rule documents the project already has (CLAUDE.md, AGENTS.md, Cursor and Copilot rules, `.claude/rules`, `.claude/docs`, contributor docs) are found and tagged by topic; `/init` reads them, carries over what hecpack lacks (loaded with the core through `--rules`), and puts each conflict to the user with the trade-off.
- `/hecpack:metrics`: snapshots of code shape and commit rhythm, stored in the plugin's data folder, with the before/after table.
- Optional module `git-safety` (deny destructive git commands in `.claude/settings.json`).
- The preview page shows the recommended level, the rule documents found, the optional modules and the exact `/hecpack:init` command for the selection.

## Next

1. **Local skills for gaps**: `/init` writes `.claude/skills/<tech>/SKILL.md` for a technology with no pack or plugin, from the installed version's docs (context7) and the project's own code.
2. **First stack packs** as separate plugins in this marketplace: `expo-ios-hig` (platform file pairs, HIG checklist, designer agent, render-performance checklist), `nx-monorepo` (layered libs, arch-check script, safe move script). A `format-hooks` module (prettier on every edit, as in Wayfarer) when prettier is detected.
3. **Enabled plugins**: the page misses plugins enabled outside settings files (for example by the desktop app); find a reliable source.
4. **Benchmark**: `claude plugin eval` with `--ablation with-without` on a few tasks (triage line present, architect called on M, checker used for validation, rules loaded after compaction); cost and turns with and without the plugin. `/hecpack:metrics` on the real projects over a month.
5. **Publishing**: README with a screenshot and the eval numbers, submission to the Anthropic plugin directory, a short post.

## Open questions

- Whether `core/` should stay one set for all levels or split per level.
- Whether metrics snapshots should live in the project (`.claude/hecpack/metrics/`) so a team shares them; today they stay in the plugin's data folder so the project is never touched.
