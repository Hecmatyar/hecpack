---
name: move
description: Move or rename files and folders in a JavaScript or TypeScript project and rewrite every import that pointed at them (relative paths, tsconfig aliases, package entries and their export lines, across packages), with a dry run first. Use whenever a task moves, renames or regroups source files or folders, instead of mv and hand edits, or when the user runs /hecpack:move.
allowed-tools: Bash(node:*)
---

# hecpack move

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/move.mjs" --dry-run <from> <to> [<from> <to> …]
node "${CLAUDE_PLUGIN_ROOT}/scripts/move.mjs" <from> <to> [<from> <to> …]
```

Paths are relative to the working directory; the project is its git work tree (`--project <dir>` for another). It reads the project's layout fresh each time (packages, aliases, platform suffixes, route folders; the Layout section of `.claude/hecpack/stack.md` shows it) and parses with the project's own TypeScript.

- `<to>` is the full new path, never a folder to drop the file into. A file, or a module path without extension, moves its group: platform variants (`Foo.ios.tsx`), same-base tests and stories, an image's `@2x` and `@3x`; a new base name renames them all. Moves that belong together go in one call, so the links between them stay right.
- Run `--dry-run` first when the move crosses packages or touches more than a few files; read the edits, then run it for real.
- Exit 2: refused, nothing written. Fix the arguments as the message says. A route folder (file paths are URLs) needs the user's yes, then `--routes`; an entry file or a package root moves by hand with its config.
- Exit 1: `todo:` lines are links it could not rewrite safely (an import that now reaches into another package's internals, a namespace import of moved names). Settle each the way the architecture wants it (export it from that package's entry, move the dependency too, or keep the file where it was); none stays open.
- `mention (not rewritten):` lines are the moved paths in docs, configs and tool settings. Update the ones that are references (the project map, rule files, jest, metro or vite configs) in the same task.
- After the move, run the `next:` command (the project's checks for the packages it touched) and list the moved files apart for the review: old → new, with only their imports changed.
- No TypeScript package found: say so to the user with the line the refusal prints (adding a dev dependency is their call) and move with the LSP's rename meanwhile.

When the user ran the command, retell the result in their language: what moved, what was rewritten, and what is left to them.
