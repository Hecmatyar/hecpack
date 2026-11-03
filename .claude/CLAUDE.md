# hecpack: working on the plugin

Russian for what the user reads (replies, task lists, questions); English for everything only agents read and for every file in this repo (code, docs, catalog, README except its Russian quickstart).

hecpack is a Claude Code plugin: a generic development workflow (core) plus a project layer generated from each project's stack. Users install it from this repo as a marketplace (`.claude-plugin/marketplace.json`, source `./`). This file is for development only; it lives in `.claude/` because `claude plugin validate` warns about a CLAUDE.md at the plugin root.

## Layout

- `.claude-plugin/` — plugin and marketplace manifests; bump `version` in both `plugin.json` and `package.json` on a release.
- `core/` — the generic rules the context hook injects (`session.md`, `workflow.md`, `coordination.md`). Project-specific facts never go here; they belong in the generated `.claude/hecpack/` of a project.
- `agents/` — `architect`, `thinker`, `checker`; users see them as `hecpack:<name>`.
- `hooks/hooks.json` + `scripts/hooks/` — context injection, model limits, handoff after compaction. Every hook is silent in a project without `.claude/hecpack/config.json` (or `context-map.json` for the context hook): keep it that way.
- `skills/` — `preview` (`scripts/preview.mjs` + `scripts/preview-page.html`), `init` (`scripts/init.mjs`, writes after the guided choice), `metrics` (`scripts/metrics.mjs`); `scripts/scan.mjs` is the JSON the skills read first. Shared logic in `scripts/lib/`: `detect` (stack, folders, Claude setup), `docs` (the project's rule documents), `sources` (packs, plugins, context7), `plan` (files per level, modules, level recommendation), `setup` (what preview, init and scan share), `metrics`.
- `catalog/` — `technologies.json` (what is detected and how), `packs.json` (hecpack stack packs).
- `tests/` — `node --test`, fixtures in `tests/fixtures/`.

## Rules

- No dependencies: Node 20+ built-ins only, ES modules (`.mjs`).
- `/preview` and `/metrics` never write into the user's project; everything goes to `${CLAUDE_PLUGIN_DATA}`. `/init` writes only after the user's confirmation, merges into CLAUDE.md and settings.json, and keeps an edited generated file unless `--force`. Tests check each of these; keep them.
- The guided choice happens in the skill (AskUserQuestion), not in the scripts: a script prints JSON or a plan, the skill asks and retells. Keep the questions few and the options one line each.
- A new technology: a row in `catalog/technologies.json` (detect, covers, search words) and a fixture or test case when detection is not a plain dependency.
- Changing a core heading that `scripts/lib/plan.mjs` references (`#Triage`, `#Chain of chats`) breaks the context map: `tests/plan.test.mjs` checks every `hecpack:` path and heading.
- Plugin docs to check before changing manifests, hooks, skills or agents: https://code.claude.com/docs/en/plugins-reference

## Validation

```bash
npm test
claude plugin validate --strict .
```

Try it locally: `claude --plugin-dir ~/hecpack` in any project, then `/hecpack:preview`.

## Git

The user commits and pushes. Do not commit, push or create releases unless asked.

## Next

See `ROADMAP.md`.
