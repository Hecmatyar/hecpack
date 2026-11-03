#!/usr/bin/env node
// /hecpack:move: moves files and folders and rewrites every import that pointed at them, across
// packages too, with the project's own TypeScript as the parser.
//
//   node move.mjs [--dry-run] [--routes] [--no-format] [--project <dir>] <from> <to> [<from> <to> …]
//
// The project is the git work tree of the working directory (or --project); paths are relative to the
// working directory, and <to> is always the full new path. A file, or a module
// path without extension, moves its whole group: base file, platform variants, same-base tests and
// stories (an image: its @2x and @3x variants); a new base name renames them all. --dry-run prints every
// move and edit and writes nothing. --routes allows moves in route folders (their paths are URLs).
// After a real move the edited files go through the project's eslint, biome or prettier when it
// configures them. Exit code 0 when clean, 1 when to-dos remain, 2 when refused.

import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { detectTechs, detectValidation, findWorkspaces, readJson } from './lib/detect.mjs';
import { readLayout } from './lib/layout.mjs';
import { move } from './lib/move/move.mjs';
import { PLUGIN_ROOT } from './lib/setup.mjs';

const USAGE = 'usage: move.mjs [--dry-run] [--routes] [--no-format] [--project <dir>] <from> <to> [<from> <to> …]';

// The git work tree the working directory is in (a worktree is its own), null outside git.
const workTree = (cwd) => {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
};

// Paths as given, relative to the working directory, as repo paths. A trailing slash stays: it marks a
// folder, which a module move refuses as <to>.
export const parseOptions = (argv, workingDir = process.cwd()) => {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      'dry-run': { type: 'boolean', default: false },
      routes: { type: 'boolean', default: false },
      'no-format': { type: 'boolean', default: false },
      project: { type: 'string' },
    },
  });
  if (!positionals.length || positionals.length % 2) throw new Error('expected <from> <to> pairs');
  // Real paths on both sides: git names the work tree by its real path (macOS /var is /private/var).
  const cwd = realpathSync(workingDir);
  const root = realpathSync(resolve(cwd, values.project ?? workTree(cwd) ?? cwd));
  const repoPath = (path) => relative(root, resolve(cwd, path)).split('\\').join('/') + (path.endsWith('/') ? '/' : '');
  const moves = [];
  for (let i = 0; i < positionals.length; i += 2) moves.push({ from: repoPath(positionals[i]), to: repoPath(positionals[i + 1]) });
  return { root, moves, dryRun: values['dry-run'], routes: values.routes, format: !values['no-format'] };
};

export const run = (options) => {
  const pkg = readJson(join(options.root, 'package.json'));
  const workspaces = findWorkspaces(options.root, pkg);
  const catalog = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'catalog/technologies.json'), 'utf8'));
  const validation = detectValidation(options.root, pkg, detectTechs(options.root, workspaces, catalog));
  return move({ ...options, layout: readLayout(options.root, workspaces), validation });
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let options;
  try {
    options = parseOptions(process.argv.slice(2));
  } catch (error) {
    console.error(`move: ${error.message}\n${USAGE}`);
    process.exit(2);
  }
  const { exitCode, lines } = run(options);
  console.log(lines.join('\n'));
  process.exitCode = exitCode;
}
