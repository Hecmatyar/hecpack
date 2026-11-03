#!/usr/bin/env node
// SessionStart (compact): lists the handoff notes of the last two days, so the session continues from its
// own note rather than from the summary. No notes, or a project not set up by hecpack: silent.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

try {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const root = resolve(process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? '.');
  const dir = join(root, 'tmp/handoff');
  if (existsSync(join(root, '.claude/hecpack/config.json')) && existsSync(dir)) {
    const since = Date.now() - WINDOW_MS;
    const notes = readdirSync(dir)
      .filter((name) => name.endsWith('.md'))
      .map((name) => ({ name, time: statSync(join(dir, name)).mtimeMs }))
      .filter((note) => note.time >= since)
      .sort((a, b) => b.time - a.time)
      .map((note) => `tmp/handoff/${note.name}`);
    if (notes.length) {
      const text = `The context was just compacted. Handoff notes from the last two days, newest first:\n${notes.join('\n')}\nIf one of them is this task's note (the path you wrote earlier, or the one the summary names), read it now and continue from it rather than from the summary; ignore the others.`;
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: text,
          },
        }),
      );
    }
  }
} catch (error) {
  console.error(`hecpack after-compact hook: ${error.message}`);
}
