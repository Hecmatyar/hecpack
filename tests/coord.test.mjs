import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { coord, summary } from '../scripts/coord.mjs';
import { plan } from '../scripts/lib/plan.mjs';
import { detect } from '../scripts/lib/detect.mjs';
import { catalog, FIXTURES, PLUGIN, scratch } from './helpers.mjs';

const project = () => {
  const root = scratch();
  mkdirSync(join(root, 'tmp/handoff'), { recursive: true });
  writeFileSync(join(root, 'tmp/handoff/sync.md'), '# Sync engine\n\n- items\n');
  writeFileSync(join(root, 'tmp/handoff/settings.md'), '# Settings screen\n');
  writeFileSync(join(root, 'tmp/handoff/sync.report.md'), '**Status:** done\n\nchanged the queue\n');
  writeFileSync(join(root, 'tmp/handoff/coordinator.md'), '# Coordinator\n');
  return root;
};

// A stand-in for `claude agents --json`: one background session per worktree name, one elsewhere.
const fakeClaude = (root, other) => {
  const bin = join(scratch(), 'claude');
  const list = [
    { sessionId: 's1', name: 'settings', kind: 'background', status: 'busy', cwd: join(root, '.claude/worktrees/settings') },
    { sessionId: 's2', name: 'lint', kind: 'background', status: 'idle', cwd: join(root, '.claude/worktrees/lint') },
    { sessionId: 's3', name: 'me', kind: 'interactive', status: 'busy', cwd: root },
    { sessionId: 's4', name: 'elsewhere', kind: 'background', status: 'busy', cwd: other },
  ];
  writeFileSync(bin, `#!/bin/sh\necho '${JSON.stringify(list)}'\n`);
  chmodSync(bin, 0o755);
  return bin;
};

test('pieces join their brief, report, background session and worktree', () => {
  const root = project();
  const state = coord({ project: root, claudeBin: fakeClaude(root, scratch()) });
  const byName = Object.fromEntries(state.pieces.map((piece) => [piece.piece, piece]));
  assert.deepEqual(Object.keys(byName).sort(), ['settings', 'sync']);
  assert.equal(byName.sync.report.status, 'done');
  assert.equal(byName.sync.title, 'Sync engine');
  assert.equal(byName.settings.session.status, 'busy');
  assert.equal(byName.settings.report, undefined);
  assert.deepEqual(state.otherSessions.map((item) => item.name), ['lint'], 'the interactive session and other projects are left out');
  assert.equal(state.coordinator, 'tmp/handoff/coordinator.md');
  assert.match(summary(state), /settings «Settings screen»: session busy; no report yet/);
  assert.match(summary(state), /background session lint \(idle\) with no brief/);
});

test('a report written inside the worktree of its piece is found there', () => {
  const root = project();
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
  git('init', '-q');
  writeFileSync(join(root, 'README.md'), '# demo\n');
  git('add', 'README.md');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  const tree = join(scratch(), 'settings');
  git('worktree', 'add', '-q', '-b', 'settings', tree);
  mkdirSync(join(tree, 'tmp/handoff'), { recursive: true });
  writeFileSync(join(tree, 'tmp/handoff/settings.report.md'), 'Status: partial\n');
  const settings = coord({ project: root, claudeBin: join(scratch(), 'missing') }).pieces.find((piece) => piece.piece === 'settings');
  assert.equal(settings.report.status, 'partial');
  assert.ok(settings.report.path.endsWith('settings/tmp/handoff/settings.report.md'));
  assert.match(readFileSync(join(PLUGIN, 'core/coordination.md'), 'utf8'), /A worktree starts from the last commit/);
});

test('without claude agents only the files are shown', () => {
  const root = project();
  const state = coord({ project: root, claudeBin: join(scratch(), 'missing') });
  assert.equal(state.sessionsAvailable, false);
  assert.match(summary(state), /only the files are shown/);
  assert.match(execFileSync('node', [join(PLUGIN, 'scripts/coord.mjs'), '--project', scratch()]).toString(), /nothing is being coordinated/);
});

test('code sessions above lite carry the coordinator section; the brief names the report file', () => {
  const coordination = readFileSync(join(PLUGIN, 'core/coordination.md'), 'utf8');
  assert.match(coordination, /^## Sub-sessions and the coordinator$/m);
  assert.match(coordination, /tmp\/handoff\/<piece>\.report\.md/);
  assert.match(coordination, /\/hecpack:coord/);
  const detection = detect(join(FIXTURES, 'ts-vite'), catalog());
  const map = (level) => JSON.parse(plan({ detection, sources: [], level, readProject: () => undefined, date: '2026-11-03' }).find((file) => file.path.endsWith('context-map.json')).content);
  assert.ok(map('standard').types.code.includes('hecpack:core/coordination.md#Sub-sessions and the coordinator'));
  assert.ok(map('deep').types.code.includes('hecpack:core/coordination.md#Chain of chats'));
  assert.ok(!map('lite').types.code.some((spec) => spec.includes('coordination.md')));
});
