# Workflow: triage, architect loop, thinker, models

How a code task runs. Injected by the hecpack context hook into every code session and the coordinator.

## Triage

- **Triage first.** Before any work, size the task and write it as one line to the user (the class and what runs, e.g. «S: editing `UserCard.tsx`, then a short review»); the user may correct it before tokens are spent. Re-triage when the task turns out bigger or the cause unclear.
  - **Design or product question** (what to build, how it looks or behaves, several readings that lead to different work): ask the user first, before any agent.
  - **Unclear cause** (as under Thinker below): thinker first, then triage again with its result.
  - **S**: 1–2 files, no new file, export or move, no change to a data flow, persistence or data shape (a string, style or copy change inside one file is S too). Code it, validate, then one review round on the diff marked `S`; no analysis. The reviewer first checks the diff still fits S; on `RETRIAGE: M` run the analysis on the task and bring the change to its plan.
  - **M**: everything else (new code, a move or restructure, a data-flow change, 3+ files): the full architect loop below.

## Architect loop

- **Architect loop** (`hecpack:architect`, read-only subagent) for M tasks; S tasks get only its review. Before coding: run it in analysis mode with the task, the thinker's report when there was one, and the files and folders already known, so it starts there instead of exploring; it returns the behavior to deliver (acceptance bullets), where each part lands, what existing code is in the way and the plan with its restructuring. Its open questions go to the user as options before coding; then follow the plan.
- While coding, a departure from the plan is allowed only for a fact the plan did not have (a caller it missed, a type that does not fit, an API that behaves otherwise): note each one at once as «step N: did X instead of Y, because Z» with the evidence (`file:line`, an error, a doc). A departure that changes the behavior list or where a part lands goes to the user as options first.
- After coding and validation: run it in review mode with the behavior list, the plan, the departures and the list of files you changed (never «the working tree»: other sessions may edit it in parallel). Fix every violation, apply or reject each suggestion with a one-line reason, apply every `could be better (small)` item in the same round, then continue the same reviewer (SendMessage to its agent id) with what was fixed and rejected: round two checks that delta. Done when it returns `CLEAN`; after two rounds the rest goes to the user as options.

## Thinker

- **Thinker** (`hecpack:thinker`, read-only subagent) before the architect when the cause is unknown or disputed: a bug with several plausible explanations, one that came back or survived a fix, races, time zones, caches, a slowdown with no obvious culprit, or a «how should we solve X» with several sensible answers. Not for a small clear bug whose cause is known. Brief it with the user's words, what the screenshots show and what was tried, never your own guess as the frame. Its checks that need the user's device or account go to the user as exact steps, its ways out as options with its pick; the chosen one is triaged again. New facts go to the same thinker (SendMessage). A `Stuck` report goes to the user with its questions.

## Design

- A design task (new UI from a description, a design round, a refinement of a screen's look) runs in `hecpack:designer`, never in the session itself: the brief names the goal, what is approved and the screens or components it touches. The designer uses the project's own design system, tokens and design docs when they exist and proposes its own when they do not; its proposal becomes the project's rule only with the user's word (then it is saved as a rule file and listed in `context-map.json`). A new idea is shown small first (one or two key screens, A and B variants); only an approved idea is spread to every state, and only then does it go to code, as a normal code task through triage. The main session picks the model: a new idea or variants on the default, a mechanical pass over an approved design on `sonnet`.

## E2E

- E2E runs only on the user's request, in `hecpack:e2e-runner` (its own small context, a report under 30 lines); fixes stay in the session. One runner per run; reruns of its failures go to the same runner (SendMessage), a new level or scope gets a fresh one. A task that changes a screen, a main action, UI text or test ids updates the e2e tests of that area in the same task, or its report names the e2e areas it may have made stale. A bug the user found past e2e gets a test at the cheapest level that catches it. A test over budget or flaky is fixed, never retried silently or skipped. The commands and the suite's rules live in `.claude/hecpack/stack.md` § E2E.

## Models

- The session (the coder) runs on the model picked by the user. Subagent models live in one table, `agentModels` in `.claude/hecpack/config.json`; the hecpack agent-model hook refuses an Agent call whose `model` override breaks it. Effort follows the stakes: the architect's analysis runs at `max` when the thinker rated the task's complexity high, its review at `high`; round two continues the same agent and keeps that effort.
- Validation runs, closing checks and diff summaries go to `hecpack:checker` (read-only, a two-or-three-line verdict), so their logs stay out of the session.
