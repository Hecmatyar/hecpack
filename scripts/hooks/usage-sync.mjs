#!/usr/bin/env node
// SessionStart: brings the /hecpack:usage store and page up to date in the background, so the page is
// current whenever it is opened and the history outlives the transcripts Claude Code deletes after a month.
// Runs in a project hecpack set up, or one where /hecpack:usage was run before; elsewhere it does nothing.
// Prints nothing (SessionStart output would go into the context) and returns at once: the count runs in a
// detached process. The first count in a project reads the last 7 days; later ones only the new sessions.
//
//   node usage-sync.mjs --out <dir>      (the hook passes ${CLAUDE_PLUGIN_DATA}/usage)

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { storeDir } from '../usage.mjs';

const USAGE = fileURLToPath(new URL('../usage.mjs', import.meta.url));

export const syncPlan = ({ root, out }) => {
  if (!out || out.includes('${') || !root) return undefined;
  const store = join(storeDir(out, root), 'store.json');
  if (!existsSync(join(root, '.claude/hecpack/config.json')) && !existsSync(store)) return undefined;
  return [USAGE, '--project', root, '--out', out, '--quiet'];
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    let input = {};
    try {
      input = JSON.parse(readFileSync(0, 'utf8'));
    } catch {
      input = {};
    }
    const outIndex = process.argv.indexOf('--out');
    const out = outIndex > 0 ? process.argv[outIndex + 1] : undefined;
    const root = resolve(process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? '.');
    const args = syncPlan({ root, out });
    if (args) spawn(process.execPath, ['--no-warnings', ...args], { detached: true, stdio: 'ignore' }).unref();
  } catch (error) {
    console.error(`hecpack usage-sync hook: ${error.message}`);
  }
}
