import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { codeMetrics, compare, gitMetrics } from '../scripts/lib/metrics.mjs';
import { metrics, parseArgs } from '../scripts/metrics.mjs';
import { FIXTURES, scratch } from './helpers.mjs';

const repo = () => {
  const project = scratch();
  cpSync(join(FIXTURES, 'ts-vite'), project, { recursive: true });
  const git = (...args) => execFileSync('git', ['-C', project, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { stdio: 'ignore' });
  git('init', '-q');
  writeFileSync(join(project, 'src/pages/Home.tsx'), 'export const Home = () => null;\n// TODO: content\n');
  writeFileSync(join(project, 'src/pages/Home.test.tsx'), 'test("home", () => {});\n');
  writeFileSync(join(project, 'package-lock.json'), '{}\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: home page');
  writeFileSync(join(project, 'src/pages/Home.tsx'), 'export const Home = () => <div />;\n');
  git('commit', '-qam', 'fix: render the home page');
  return { project, git };
};

test('arguments', () => {
  assert.deepEqual(parseArgs(['--days', '7', '--compare']), { days: 7, compare: true, json: false, save: true });
  assert.throws(() => parseArgs(['--days', 'many']));
});

test('code metrics count source and test files and skip lock files and node_modules', () => {
  const { project } = repo();
  mkdirSync(join(project, 'node_modules/x'), { recursive: true });
  writeFileSync(join(project, 'node_modules/x/index.js'), 'x\n'.repeat(500));
  const code = codeMetrics(project);
  assert.equal(code.sourceFiles, 1);
  assert.equal(code.testFiles, 1);
  assert.equal(code.todos, 0);
  assert.ok(!Object.keys(code.byExtension).includes('.json'));
});

test('git metrics read the window and ignore lock files', () => {
  const { project } = repo();
  const g = gitMetrics(project, 30);
  assert.equal(g.commits, 2);
  assert.equal(g.authors, 1);
  assert.equal(g.fixShare, 0.5);
  assert.ok(g.hotFiles.every((item) => item.path !== 'package-lock.json'));
  assert.equal(gitMetrics(scratch(), 30), undefined);
});

test('snapshots are stored outside the project and compared with the previous one', () => {
  const { project } = repo();
  const out = scratch();
  const first = metrics({ project, out, days: 30, save: true, date: '2026-10-01T00:00:00Z' });
  assert.ok(existsSync(first.file));
  assert.equal(first.comparison, undefined);
  writeFileSync(join(project, 'src/pages/About.tsx'), 'export const About = () => null;\n');
  const second = metrics({ project, out, days: 30, save: true, date: '2026-11-01T00:00:00Z' });
  assert.equal(readdirSync(second.dir).length, 2);
  assert.equal(second.comparison.find((row) => row.path === 'code.sourceFiles').delta, 1);
  assert.match(second.table, /\| Source files \| 1 \| 2 \| \+1 \|/);
  assert.ok(!existsSync(join(project, '.claude')) && !existsSync(join(project, 'metrics')));
  assert.equal(compare(first.snapshot, second.snapshot).length > 5, true);
});
