# hecpack

A development workflow for Claude Code that adapts to your stack. Install it, run one command, pick what you need, and your project gets a disciplined way of working: triage before coding, an architect that reviews, a thinker for unclear bugs, validation in its own small context, rules that load by themselves and survive compactions.

Grown out of the setup of one Expo + Nx app ([Wayfarer](https://github.com/Hecmatyar)); the core is generic, the specifics of your project are generated from what is in the repo.

## Install

```bash
claude plugin marketplace add Hecmatyar/hecpack
claude plugin install hecpack@hecpack
```

`/hecpack:init` and `/hecpack:preview` run on the strongest model your account has (`model: best`: Fable where it is available, Opus otherwise) for that command only; your session model comes back with your next prompt.

The pages (`/preview`, `/usage`, `/context`) come in the language you write to Claude in. hecpack ships them in English; the first time you open one in another language, Claude translates its strings once and keeps them in the plugin's data folder, so later pages, including the usage page the background count rebuilds, open in your language with no model call.

`--scope local` keeps the plugin to you and the current project. Nothing changes in a project until you set it up: every hook is silent without `.claude/hecpack/config.json` (the usage count, which writes only into the plugin's data folder, also runs where you opened `/hecpack:usage` before).

## Commands

| Command | What it does | Touches the project |
| --- | --- | --- |
| `/hecpack:preview` | Reads the stack and opens a local page: technologies found, the recommended level, where the rules for each technology can come from, the rule documents you already have, the installed plugins and skills that clash with each other or with hecpack, the diff of every file each level would write, the plugins worth installing. `--try` writes the files into a throwaway clone. | No |
| `/hecpack:init` | A guided setup: one round of questions (level, technologies), a pass over the rule documents you already have (what to carry over, what conflicts and why) and over the installed plugins and skills (each clash compared, with the one to keep), the plan with diffs, then the files. | Yes, after your confirmation |
| `/hecpack:metrics` | A snapshot of the project's shape (files, lines, tests, big files, TODOs) and rhythm (commits, lines and files per commit, fix share, reverts), compared with the previous snapshot. Take one right after `/init` and another after a few weeks. | No (snapshots live in the plugin's data folder) |
| `/hecpack:usage` | A local page with the tokens and money Claude Code spent in the project, per model and per day, built from the transcripts Claude Code already keeps: period filter, models toggled in the legend, the cost of a working hour and of a prompt, cost and tokens per day, cumulative cost, where the money goes (by stage of the work: reading, edits, checks, the architect, other subagents, design, answers; by context size; by agent, with sessions, compactions and subagent runs), before/after the day hecpack was set up, a per-model table. The first run counts the last 7 days (`--rebuild --history-days N|all` for more); after that a hook at each session start adds the new sessions in the background, and the totals outlive the transcripts Claude Code deletes after a month. No model call: the page opens instantly, and its file can be bookmarked. | No (page and cache live in the plugin's data folder) |
| `/hecpack:context` | A local page with the context tree: for each mode of the main session and each agent, what loads at start (CLAUDE.md and its imports, rules without paths, the memory index, the agent and skill lists, the hook's files, the agent's own instructions) and what it may read by link. Plus the files that cost most at start, the rules by path, the docs nobody reads, the repeated text and the change since the last run. Tokens are characters / 4. | No (page lives in the plugin's data folder) |
| `/hecpack:move` | Moves or renames files and folders and rewrites every import that pointed at them: relative paths, your tsconfig and jsconfig aliases, workspace package names and the export lines of package entries, across packages too; a file moves with its platform variants, tests and stories, an image with its `@2x` and `@3x`. Reads the project's layout fresh each run, parses with the project's own TypeScript, refuses before writing anything (route folders need `--routes`, entry files and package roots stay), lists what it could not rewrite and the docs and configs that name the old paths, then formats with your eslint, biome or prettier and names your checks. The model uses it whenever a task moves files; `--dry-run` prints every edit. | Yes, the move itself |
| `/hecpack:coord` | The pieces a session coordinates in one call: briefs and reports in `tmp/handoff/`, the background sessions Claude Code runs for the project, the worktrees. The coordinating session uses it too, instead of reading every file. | No |

## What you get after `/hecpack:init`

- **Task triage.** Every code task starts as S (one obvious change) or M (new code, a move, three or more files). M gets an architect analysis before coding; every task gets an architect review after it.
- **Agents.** `hecpack:architect` (read-only analysis and review), `hecpack:thinker` (root cause when it is unknown or disputed), `hecpack:checker` (runs your typecheck, lint and tests in its own small context and answers in three lines). With a UI stack also `hecpack:designer` (design passes on your own design system and docs, or a proposed one when you have none; a new idea shown small first, A and B variants), and with an e2e suite `hecpack:e2e-runner` (runs it in its own context, reports failures in under 30 lines). Without e2e, `stack.md` says what suite would fit and how to turn the runner on.
- **How code is changed, for every code session and the architect** (`core/code.md`): the change that fits the architecture rather than the smallest diff, defects next to your change fixed in the same task and small improvements applied at once, bugs fixed at the root, an abstraction only with a second use, the stack's own solution before an outside one before your own, UI as a construction kit of dumb and smart parts, the owner mutates its data; UI that repeats the approved design, no tuning gaps, strings that fit their slot in every language; errors shown by who notices them; tests that assert outcomes, mock only what is missing and fail once before they pass. Plus validation of every project you changed, search with the LSP first, and the rule that uncommitted changes of others are never touched.
- **Rules injected per task.** A hook loads the rules a task needs at the first prompt, again after a compaction, and when an agent starts. A tag in the prompt (`[S]`, `[M]`, `[q]`, `[coord]`) picks the set. Your own rule files ride along: `/init` adds the ones you keep to the same map.
- **Handoff across compactions** (with compact instructions in CLAUDE.md: what a summary keeps and drops) and an optional chain of fresh chats for long tasks.
- **A coordinator when it pays, with or without Claude Projects.** In a project chat that starts threads, the platform coordinates. In plain sessions the session the task came to takes the role, but only for two or more independent pieces big enough to beat a sub-session's own start cost. It picks subagents first and background sessions (`claude --bg`) for long pieces, in the same folder on separate files (a worktree only when the base is committed, since a worktree has none of the uncommitted work), keeps to 2–3 at a time, and stays serial when plan limits are tight. Briefs and reports live in `tmp/handoff/`, and `/hecpack:coord` shows every piece, its session, worktree and report in one call.
- **Model limits per agent**, enforced by a hook, and a designer report that lacks its checklist line goes back to the designer once.
- **Your project's facts** in `.claude/hecpack/`: `stack.md` (technologies, versions, validation commands, the layout: packages, aliases, platform suffixes, route folders; gaps), `project-map.md` (one line per folder), `config.json` (level, language, thresholds, models), `context-map.json` (which rules load for which task and agent). Generated from the repo, yours to edit; a second `/init` keeps what you edited.

### Levels

| Level | What it sets up |
| --- | --- |
| lite | Session rules, triage, the stack and validation commands, the checker agent |
| standard | Lite plus the architect loop, the thinker, the project map and the coordinator role when splitting pays |
| deep | Standard plus the chain of chats, an explicit `[coord]` coordinator session and model limits per agent |

`/init` recommends one from the stack: deep for a monorepo with several workspaces, standard for a project with a real stack and tests, lite otherwise. You can always change `level` in `config.json`.

### Your existing rules

`/init` and `/preview` find the rule documents already in the project: `CLAUDE.md`, `AGENTS.md`, Cursor and Copilot rules, `.claude/rules`, `.claude/docs`, contributor docs. `/init` reads them and sorts every rule: already covered by hecpack (nothing to do), worth carrying over (kept where it is and loaded with the core, or moved into a short `.claude/hecpack/rules/<topic>.md`), or in conflict with hecpack. Each conflict comes to you as a question with both rules and the trade-off; nothing is replaced without your answer, and nothing of yours is deleted.

## Coexisting with your own setup

`/preview` and `/init` check what is already installed: your plugins (on and off), your own and the project's skills, agents, commands, hooks and MCP servers. They find where these overlap with each other and with what hecpack adds:

- **clash**: two things that start by themselves for the same job (two design skills the model may pick, two agents that review), or two hooks on the moment hecpack injects its rules or checks agent calls;
- **overlap**: the same job in commands you call by name, a project command that hides your own one with the same name, an MCP server set up twice;
- **works together**: something hecpack calls on when it is there, such as the `frontend-design` skill inside the designer.

`/init` reads each side of a clash, compares what they do, what they cost and how they fit the stack, recommends the one to keep (or a split, written to `.claude/hecpack/rules/coexist.md`) and asks you. When another plugin does design or e2e better, `--without designer` or `--without e2e-runner` leaves hecpack's agent out and its hook refuses calls to it. hecpack never disables or removes anything of yours: it gives you the `claude plugin disable` command or names the file.

hecpack sets no permissions and no git policy: what the agent may run, commit or push comes from your own `settings.json` and environment, and `/init` never touches `.claude/settings.json`.

## Development

```bash
npm test
claude plugin validate --strict .
claude --plugin-dir .          # try it in any project, then /hecpack:preview
```

Node 20 or newer. No dependencies. Layout and rules for contributors: `.claude/CLAUDE.md`; what is next: `ROADMAP.md`.

## License

MIT
