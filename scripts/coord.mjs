#!/usr/bin/env node
// /hecpack:coord: the state of the pieces a session coordinates, in one call and without reading every
// file: the briefs and reports in tmp/handoff/, the background sessions Claude Code runs for the project
// (`claude agents --json`), and the git worktrees. Read-only.
//
//   node coord.mjs --project <dir> [--json] [--claude-bin claude]

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const parseArgs = (argv) => {
  const args = { json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') args.json = true;
    else if (arg.startsWith('--')) {
      const [key, inline] = arg.slice(2).split('=');
      args[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = inline ?? argv[++i];
    }
  }
  return args;
};

const firstHeading = (text) => text.match(/^#\s+(.+)$/m)?.[1].trim();
const statusOf = (text) => text.match(/^\s*(?:\*\*)?Status(?:\*\*)?:\s*(?:\*\*)?\s*(done|partial|blocked)\b/im)?.[1].toLowerCase();

const run = (bin, args, cwd) => {
  const result = spawnSync(bin, args, { cwd, encoding: 'utf8', timeout: 15000 });
  return result.status === 0 ? result.stdout : undefined;
};

// Background sessions of this project: Claude Code's own list, kept to the project and its worktrees.
export const sessionsOf = (root, bin = 'claude') => {
  const out = run(bin, ['agents', '--json', '--all'], root);
  if (out === undefined) return { available: false, sessions: [] };
  let list;
  try {
    list = JSON.parse(out);
  } catch {
    return { available: false, sessions: [] };
  }
  const sessions = (Array.isArray(list) ? list : [])
    .filter((item) => item.cwd && (item.cwd === root || item.cwd.startsWith(root + sep)))
    .map((item) => ({ id: item.sessionId ?? item.id, name: item.name, kind: item.kind, status: item.status, cwd: item.cwd, startedAt: item.startedAt }));
  return { available: true, sessions };
};

export const worktreesOf = (root) => {
  const out = run('git', ['-C', root, 'worktree', 'list', '--porcelain'], root);
  if (!out) return [];
  return out.split('\n\n').filter(Boolean).map((block) => ({
    path: block.match(/^worktree (.+)$/m)?.[1],
    branch: block.match(/^branch refs\/heads\/(.+)$/m)?.[1],
  })).filter((tree) => tree.path && resolve(tree.path) !== root);
};

export const coord = ({ project, claudeBin = 'claude', now = Date.now() }) => {
  const root = resolve(project ?? process.cwd());
  const dir = join(root, 'tmp/handoff');
  const names = existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.md')) : [];
  const { available, sessions } = sessionsOf(root, claudeBin);
  const worktrees = worktreesOf(root);
  const pieces = names
    .filter((name) => !name.endsWith('.report.md') && name !== 'coordinator.md')
    .map((name) => {
      const piece = name.slice(0, -3);
      const brief = join(dir, name);
      const session = sessions.find((item) => item.name === piece || basename(item.cwd) === piece || (item.name ?? '').endsWith(`-${piece}`));
      const worktree = worktrees.find((tree) => basename(tree.path) === piece || tree.branch?.endsWith(piece));
      // The report belongs in this checkout; a piece that wrote it inside its worktree is found there too.
      const reportFile = [join(dir, `${piece}.report.md`), worktree && join(worktree.path, 'tmp/handoff', `${piece}.report.md`)].find((file) => file && existsSync(file));
      const report = reportFile ? readFileSync(reportFile, 'utf8') : undefined;
      return {
        piece,
        title: firstHeading(readFileSync(brief, 'utf8')),
        briefAgeMin: Math.round((now - statSync(brief).mtimeMs) / 60000),
        report: report === undefined ? undefined : { status: statusOf(report) ?? 'unknown', path: relative(root, reportFile), ageMin: Math.round((now - statSync(reportFile).mtimeMs) / 60000) },
        session: session ? { id: session.id, status: session.status, kind: session.kind } : undefined,
        worktree: worktree ? { path: worktree.path, branch: worktree.branch } : undefined,
      };
    })
    .sort((a, b) => a.briefAgeMin - b.briefAgeMin);
  const known = new Set(pieces.map((piece) => piece.session?.id).filter(Boolean));
  const coordinatorFile = join(dir, 'coordinator.md');
  return {
    root,
    pieces,
    otherSessions: sessions.filter((item) => item.kind !== 'interactive' && !known.has(item.id)),
    worktrees: worktrees.filter((tree) => !pieces.some((piece) => piece.worktree?.path === tree.path)),
    sessionsAvailable: available,
    coordinator: existsSync(coordinatorFile) ? 'tmp/handoff/coordinator.md' : undefined,
  };
};

const age = (min) => (min < 60 ? `${min} min` : min < 1440 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} d`);

export const summary = (state) => {
  const lines = [];
  if (!state.pieces.length) lines.push('No briefs in tmp/handoff/: nothing is being coordinated.');
  for (const piece of state.pieces) {
    const bits = [
      piece.session ? `session ${piece.session.status}` : 'no session',
      piece.worktree ? `worktree ${piece.worktree.branch ?? basename(piece.worktree.path)}` : undefined,
      piece.report ? `report ${piece.report.status} (${age(piece.report.ageMin)} ago, ${piece.report.path})` : 'no report yet',
    ].filter(Boolean);
    lines.push(`- ${piece.piece}${piece.title ? ` «${piece.title}»` : ''}: ${bits.join('; ')}; brief ${age(piece.briefAgeMin)} old`);
  }
  for (const item of state.otherSessions) lines.push(`- background session ${item.name ?? item.id} (${item.status}) with no brief`);
  for (const tree of state.worktrees) lines.push(`- worktree ${tree.path} (${tree.branch ?? 'detached'}) with no brief`);
  if (!state.sessionsAvailable) lines.push('Background sessions: `claude agents` is not available here, only the files are shown.');
  if (state.coordinator) lines.push(`Coordinator state: ${state.coordinator}`);
  return lines.join('\n');
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const state = coord(args);
    console.log(args.json ? JSON.stringify(state, null, 2) : summary(state));
  } catch (error) {
    console.error(`hecpack coord: ${error.message}`);
    process.exit(1);
  }
}
