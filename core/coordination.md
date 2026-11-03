# Coordination: chain of chats, sub-sessions

Injected into code sessions (the chain section) and into a session that coordinates others (`[coord]`).

## Chain of chats

- One task may run as a chain of chats. Every call re-reads the whole context, so a step at 400k costs about twice one at 200k, while a fresh session starts near its base context and pays off within some ten calls. At a natural break (an iteration accepted, a phase done) with real work still ahead, when the context is above the `freshSession` threshold in `.claude/hecpack/config.json`, propose continuing in a fresh session whose brief holds the goal, the current state, decisions made, options the user rejected, files and links, and the next step.
- Write the same brief to `tmp/handoff/<name>.md` at once and keep it current at each later break. After a compaction the hecpack hook lists the recent notes: read this task's and continue from it rather than from the summary. A session compacted twice proposes the fresh session at its next natural break whatever its size.

## Sub-sessions and the coordinator

- Sub-sessions only for two or more independent pieces of real work, at most 2–3 at a time, split by files: one writer per set of files; a shared-export or theme change runs first and alone. Small pieces stay in the main chat.
- Each brief: items with acceptance, owned and forbidden files, validation, «check your context after each part; past the threshold finish the part, write a handoff and tell the main chat», «message the main chat once, when you stop», «do not start your own continuation session».
- The coordinator stays short: it does not retell a sub-session's report (one line with the link and whether the user must act), sends closing checks to `hecpack:checker`, and keeps its state (linked sessions, open decisions, what the user must do) in `tmp/handoff/coordinator.md`. Past the `coordinatorClear` threshold, with no sub-session waiting on it, it asks the user whether to clear its context and continues from that file.
