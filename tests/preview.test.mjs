import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { parseArgs, preview } from '../scripts/preview.mjs';
import { claudeHome, FIXTURES, scratch } from './helpers.mjs';

const snapshot = (dir) => {
  const out = {};
  const walk = (current) => {
    for (const name of readdirSync(current)) {
      const path = join(current, name);
      if (statSync(path).isDirectory()) walk(path);
      else out[relative(dir, path)] = readFileSync(path, 'utf8');
    }
  };
  walk(dir);
  return out;
};

test('arguments', () => {
  assert.deepEqual(parseArgs(['deep', '--techs', 'expo,nx', '--lang=ru']), { level: 'deep', lang: 'ru', try: false, open: false, techs: ['expo', 'nx'] });
  assert.throws(() => parseArgs(['--level', 'max']));
});

test('preview never touches the project and writes the page, report and diffs', () => {
  const project = join(FIXTURES, 'nx-expo');
  const before = snapshot(project);
  const out = scratch();
  const report = preview({ project, out, level: 'standard', lang: 'ru', claudeHome: claudeHome() });
  assert.deepEqual(snapshot(project), before);
  const html = readFileSync(report.paths.page, 'utf8');
  assert.ok(html.includes('"lang":"ru"') && !html.includes('/*__REPORT__*/'));
  assert.doesNotMatch(html.split('const REPORT = ')[1].split('\n')[0], /<\//, 'the inline report cannot close the script');
  const claude = report.levels.standard.files.find((file) => file.path === '.claude/CLAUDE.md');
  assert.match(claude.diff, /^\+## hecpack$/m);
  assert.equal(claude.removed, 0);
  assert.equal(report.levels.lite.files.length, 4);
  assert.ok(report.levels.lite.files.every((file) => file.path !== '.claude/settings.json'), 'hecpack never plans settings');
  assert.ok(report.docs.some((doc) => doc.path === '.claude/CLAUDE.md'));
  assert.equal(report.recommended.level, 'deep');
  assert.ok(existsSync(join(report.paths.out, 'deep/files/.claude/hecpack/context-map.json')));
});

test('an unknown tech in --techs is an error', () => {
  assert.throws(() => preview({ project: join(FIXTURES, 'ts-vite'), out: scratch(), level: 'lite', techs: ['cobol'], claudeHome: claudeHome() }), /cobol/);
});

test('--try writes the level into a clone, not into the project', () => {
  const project = scratch();
  cpSync(join(FIXTURES, 'ts-vite'), project, { recursive: true });
  const git = (...args) => execFileSync('git', ['-C', project, ...args], { stdio: 'ignore' });
  git('init', '-q');
  git('add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
  const report = preview({ project, out: scratch(), level: 'lite', try: true, claudeHome: claudeHome() });
  assert.ok(existsSync(join(report.paths.sandbox, '.claude/hecpack/config.json')));
  assert.ok(!existsSync(join(project, '.claude')));
});
