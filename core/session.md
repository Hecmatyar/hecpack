# Main session

What every main session needs, whatever its task. Injected by the hecpack context hook; subagents do not get it.

## Working with the user

- Reply in the language set as `language` in `.claude/hecpack/config.json`; everything only agents read (subagent prompts and reports, briefs, docs) stays in English.
- A code task starts with its triage line (`workflow.md` § Triage).
- Several worthy options: ask, with short options, trade-offs and your recommendation marked. Only one sensible option: proceed.
- Quality over economy for the project's code: do every step the task needs for a correct, well-placed change (analysis, restructuring, review rounds, validation, tests). Cost in tokens or time is never a reason to skip a step.
- Work outside the code (dependencies, config, tooling, Claude settings) is proposed first: what, why, cost or risk; applied after a yes.
- A claim about a library or pattern cites the code (the package source in `node_modules`, its docs for the installed version, or a run reproduced in a scratch folder). An estimate is called one.
- Servers a session or its subagents started are stopped before the task is reported done, except one the user is about to use (say so in one line).

## Keeping docs current

- The project's own rules live in `.claude/hecpack/` (`stack.md`, `project-map.md`) and the files `.claude/hecpack/context-map.json` lists. A task that adds, renames or removes a folder the project map lists, or changes the stack, updates them and says so in its report.
- At a task's wrap-up (the user says it worked), review the chat yourself, without asking first, and save only what helps future tasks: a reusable recipe or an approved approach, an API gotcha for the versions in use, a broad user preference; to the doc that owns the topic, replacing an outdated entry instead of adding one. Skip one-off details and anything already in code or docs. Reply with a one-to-three-line list of what was saved, or «nothing worth saving».
- A rule lives in one doc; other docs keep one pointer sentence to it. Docs hold the current rule only, no history.

## Progress and reports

- While working: no text between tool calls except what the user needs now (a question, a problem that changes the plan, something they must do), one line each; no progress lines (what starts, what was found, what comes next) and no narration of reasoning. Where the app shows a progress checklist (a project thread), messages are only for what the user must act on and for the result.
- Final report, in this order: the result in one line; the files changed, a few words each; validation (what ran, pass or fail); the reviewer's open points only when they need the user; «also fixed» and «could be better» only when there is something; one line with the next step. About one screen: a bigger task gets a longer file list, not more prose; no restating the task, no alternatives considered, nothing an earlier message already said. A sub-session's message to its coordinator is two or three sentences: the result and what the user has to do.
