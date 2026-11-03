---
name: arch
description: A short architecture audit of a JavaScript or TypeScript project (import loops, imports against the layers, shared UI that reaches into data, tangled folders, hubs, oversized files and folders, unused files, two libraries for one job) with the 3–5 problems worth fixing and an industry fix for each, then the accepted rules in .claude/hecpack/architecture.md; and the check of the files a task changed against those rules. Use when the user runs /hecpack:arch or asks what is tangled in the architecture, and run its check yourself during validation when .claude/hecpack/architecture.md exists.
argument-hint: "[--check <files>]"
allowed-tools: Bash(node:*), Read, Glob, Grep, AskUserQuestion, Write
---

# hecpack arch

Two modes. The script reads the whole import graph in seconds with the project's own TypeScript; you read only what it points at. Reply in the user's language; architecture.md stays in English.

## Check, during a task

When `.claude/hecpack/architecture.md` exists, validation includes:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/arch.mjs" --check <the files the task changed>
```

Exit 1 means errors: a break in a file the task touched is fixed in the same task (the code rules' «neighbours» rule), or, when the user agrees it is right, gets an `allow` entry with its why in the block. Warnings (`kit-size`, `folder-size`) are split by meaning when the task is already changing that file. The validation line of your report gives the counts.

## Audit, when the user asks

Budget: about five minutes and some fifteen file reads. Do not open every finding.

1. `node "${CLAUDE_PLUGIN_ROOT}/scripts/arch.mjs"`: JSON with `rules` (from architecture.md, or inferred from folder names), `layers`, `sharedUi`, `breaks` per rule (count and top entries), `cycles`, `twoWayPackages` and `twoWayUnits` (folders that import each other: `against` is the likely wrong direction), `hubs`, `pullsEverything`, `bigFiles`, `unused`, `twoTools`, `docs`, `readFirst`, and `proposedRules` when none are accepted yet. A refusal for a missing TypeScript package: tell the user the line it prints and stop.
2. Read the `docs` first (the project's own architecture docs and map), then the `readFirst` files, in parts when long. At most three more files, only for a question the summary cannot answer.
3. Judge. Inferred rules are guesses from folder names: a break is real only when it goes against how the project actually works (its docs, the direction most of its imports take). Drop the false ones and say why in a few words.
4. Report, about 40 lines at most:
   - **The architecture this is**, in 2–4 lines: the scheme it follows in fact (feature-sliced, layered by technical role, Nx libraries per layer, package by feature, hexagonal, MVC) and where it departs from it.
   - **3–5 key problems**, biggest first, each with: what (the count and one or two paths), why it hurts (what breaks or slows down because of it), the fix by a named industry practice adapted to this project (layers with a public API per slice as in FSD; the dependency rule of clean and hexagonal architecture; module boundaries by tags in Nx; package by feature; a shared kernel extracted; a dependency inverted through a callback or interface; a hub split by meaning), and its cost (S, M or L, and the files; moves go through `/hecpack:move`).
   - **Smaller things** in one line, and which problem to start with.
   Only problems that change how the code is worked on; not a list of every finding.
5. One `AskUserQuestion`: adopt the rules and the problem list (recommended), the rules only, or not now.
6. On a yes, write `.claude/hecpack/architecture.md` from the template below (the `hecpack-arch` block is `proposedRules` or the accepted block, corrected by your judgment: layers named as the project names them, false layers out, the accepted exceptions under `allow` with their why), then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/arch.mjs" --adopt` (it loads the file into code sessions and the architect) and `--check` once to confirm the block reads; give the counts. Tell the user the problems get fixed in the tasks that touch them, or in a task per problem when they ask.

This command changes no code.

~~~markdown
# Architecture

Accepted on <date> after /hecpack:arch. The code rules and the architect follow it; `/hecpack:arch --check` checks the files a task touches against the block at the end. It changes with the user's word when the architecture changes.

## What this project is

<2–4 lines: the scheme, the layers and what each holds>

## Rules

- <one line per rule, then its why>

## Known problems

Fixed in the tasks that touch them, biggest first; a fixed one is deleted.

- <problem>: <paths>. Fix: <the fix>. Cost: <S|M|L>.

## Check

```hecpack-arch
{
  "layers": [{ "name": "<top layer>", "paths": ["<folder>/*"], "isolated": false }],
  "roles": true,
  "sharedUi": ["<shared UI folder>"],
  "allow": [{ "from": "<glob>", "to": "<glob>", "why": "<reason>" }],
  "limits": { "kitLines": 150, "kitImports": 12, "folderModules": 15 }
}
```
~~~

Layers go top to bottom; a trailing `/*` makes each folder below a slice, and `isolated` keeps the slices of a layer from importing each other. `roles` keeps role folders in one direction (components → hooks → store → api → lib → constants → types). `sharedUi` folders import no store, api or feature code.
