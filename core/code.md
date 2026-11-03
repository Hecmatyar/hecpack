# Code: how to change the project's code

How code is built and changed. Injected by the hecpack context hook into every code session and the architect. The project's own rule files (listed in `.claude/hecpack/context-map.json`) win where they say more.

## Changes

- Make the change that fits the architecture, not the smallest diff. The restructuring a task needs to land cleanly (a rule moved to its owner, a grown component split, a part lifted a layer) is part of the task and is applied at once, even when it is large. Batch all edits to one file together.
- **Scope is what the task needs, done in full**: the restructuring it calls for, defects in the files it touches, tests and review rounds. Worthwhile work the task does not need (cleaner code elsewhere, a real performance problem) is proposed with what, why and size, and applied after a yes.
- **Neighbours get a look**: in every file the task touches, read the surrounding code and fix the defects there in the same task (a bug, a broken documented rule such as a literal instead of a token, a stale comment, an error swallowed by a `catch`); list them under «also fixed». Code that works but could be better is not a defect. A small improvement (a few lines in a touched file, no new file or export, no behaviour change) is applied in the same pass, the first review round included; a larger one goes under «could be better» with what, why and size, and waits for the user.
- **Bug fixes**: before fixing, find every caller and use of the broken code (the LSP's references, then a text search for mocks, docs and configs), then fix the root cause once, in the shared code that owns it, not with a patch at each call site or symptom.
- A standalone audit or refactor proposal (not part of a task, «what can be improved»): each item separately with what changes (a short example, the files, the cost) and a recommendation, applied after the user's comment on it. Say when an item is only a theoretical risk, and recommend leaving it when following a rule would cost readability.
- Splitting or merging stores or modules: confirm first what stays in each before deleting anything.

## Style

- Follow the existing patterns, hooks, utilities and shared components; new state management or architecture comes after the user's approval. The style reference is the tracked project code: match its naming, structure, imports and idioms; nearby files in the same module win over general conventions.
- Readability first: clear, explicit, conventional code over clever or compact. An abstraction needs a second use; a comment explains only non-obvious behaviour.
- File order: the public API first (exported types, then the main component or function), then helpers, constants, schemas and secondary parts, so the file opens on the main thing.
- **Something the task needs that the project lacks** (a capability, a pattern, a library use, a structure): look first in what the stack already has (the project's own code, then its frameworks, libraries and platform APIs, checked in the docs for the installed version), then the industry reference solution for that version, and only then write our own. Adapt the pick to the project's style. When the best choice is not obvious, compare the candidates with our own implementation (pros, cons, cost to add and maintain, fit with the stack) and ask; a new dependency needs approval.
- Performance: consistent, correct, readable, simple, in that order. Optimize only where it can matter (state the consequence and the data volume); no micro-optimizations for one small screen. Never leave a known serious problem that is easy to fix: work done for a hidden screen or closed panel, a quadratic pass over growing data, a whole form or list re-rendered on every keystroke, a time value or cache that goes stale over a long session.

## Structure

- **Build UI like a construction kit.** Split a component into small parts (a block, a row, a slot layout, a hook) that are combined by composition (slots, `children`) instead of one component that knows everything. Each file imports only what is related by meaning and its markup starts near the top; a file past about 150 lines or 12 imports is split by meaning, not grown.
- **Dumb and smart.** Shared dumb components take structural props and hold no logic; dumb blocks that belong together may join into a bigger dumb block by meaning, never into a many-prop composition. Smart parts take the domain object, derive their own data through the domain's functions and render through the dumb ones, never the other way: a dumb component imports no store, data hook or smart part. An assembly only composes smart parts and computes nothing for them; no wrapper that only forwards fields.
- **Layers.** Imports point from delivery (pages, screens, routes, handlers) to domain to infrastructure, never sideways or back; a cross-module consequence lives in the owner's action. The owner mutates: the module that stores the data exposes the action, everyone else calls it. Lifetime decides where data lives: needed while no screen shows it, a domain store; by every open copy of a widget, its shared scope; by one copy, its own state.
- Global reads (session, language, connectivity) are free in any layer; context (the selected item, the mode) comes through props, and a part never reads another widget's context.
- **Reusable by default, placed by likelihood.** A unit that does one job takes data in and gives callbacks out, so it can be lifted without a rewrite. Likely needed elsewhere: the shared place now; clearly one-off: next to its user. When a second user appears, it moves up by the same rule.
- **Readability beats purity.** No prop cascades to avoid a global read, no three-file split for a 20-line thing, no interfaces or adapters for one caller. When a liberty buys clear simplicity, take it and leave a one-line comment on why.

## UI

- **Design first**: UI built from an approved design repeats it exactly (layout, sizes, shapes, colours); a design value with no token gets a new token, not the nearest existing one. Departures come only afterwards and with the user's word; when matching the design is impossible or risky, say so with the reason before building anything else.
- **No phantom spacing**: elements sit by the design system's own layout; a gap, margin, padding or nudge is added only where the design needs it, never to «tune» a look.
- Icons and other visuals are never invented or hand-drawn: they come from the design the user points to or from the project's icon set; when nothing fits, ask.
- Every added or changed UI string fits its slot in every language the project ships. Find where it renders first: in a tight slot (a button, tab, badge, chip, menu item, title) a translation stays within the design language's width; flowing text (body, alerts, toasts) needs no budget. Use the platform's own word for a standard control in that language, the grammatical form the slot calls for (a button is a verb, a label a noun), and plural forms for a count. Write every locale yourself and end with one line naming the tight strings, so the user can check them.

## Errors and feedback

- Decide by who notices: an action the user started that failed shows an error to them and logs it; background work that failed (a sync, a refresh) only logs and retries, a message would nag; a validation error shows under its field, never as a popup; an expected error code (a wrong password, a taken name) maps to a message in place; a cancel by the user is a result, not an error, and returns silently; a failed cleanup after success is a warning.
- One log per failure, at the place that owns the decision, in the form `<Subject> <verb> failed` with the error object. Domain and storage code raise or return the failure; the caller that the user acted through decides the feedback, and an editor waiting on a save stays open with its edits when the save fails.
- A sequence leaves nothing half-saved where it can: write the new thing first, switch the reference second, delete the old one last. A request the server's rules reject is a logic bug to fix, not an error path to catch.
- Every user-visible error has its text in every locale.

## Tests

- Test the logic with its real collaborators; mock only what does not exist in the test environment (a device API, the native layer, the router), never the project's own modules. Pure logic with branches gets unit tests; UI is checked by the user and by e2e. Date and time logic runs under several time zones (one far east, one far west, one with a midnight DST switch).
- Assert outcomes the user sees or the store and server keep, not calls (a call assertion only at a boundary that cannot be observed otherwise).
- A new test must fail at least once: break the code under test for a moment, see it red, and restore the file from a copy (others may have uncommitted edits in it: never `git checkout` it).
- When a test fails, first find out whether the requirement changed (the test is outdated) or the behaviour broke (the code is wrong); show the user the cause and fix after their answer.
- A known bug the user has not decided on stays as an expected-failure test with a comment, so it turns red once fixed. Every bug the user found becomes a failing test first, then the fix, at the cheapest level that catches it.
