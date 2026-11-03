import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { init, parseArgs } from '../scripts/init.mjs';
import { scan } from '../scripts/scan.mjs';
import { recommendLevel } from '../scripts/lib/plan.mjs';
import { detect } from '../scripts/lib/detect.mjs';
import { catalog, claudeHome, FIXTURES, scratch } from './helpers.mjs';

const copy = (fixture) => {
  const project = scratch();
  cpSync(join(FIXTURES, fixture), project, { recursive: true });
  return project;
};

test('arguments', () => {
  const args = parseArgs(['--level', 'lite', '--techs', 'react, vite', '--rules=docs/a.md', '--modules', 'format-hooks', '--write']);
  assert.equal(args.level, 'lite');
  assert.deepEqual(args.techs, ['react', 'vite']);
  assert.deepEqual(args.rules, ['docs/a.md']);
  assert.deepEqual(args.modules, ['format-hooks']);
  assert.equal(args.write, true);
  assert.deepEqual(args.without, []);
  assert.deepEqual(parseArgs(['--without', 'designer,e2e-runner']).without, ['hecpack:designer', 'hecpack:e2e-runner']);
  assert.throws(() => parseArgs(['--level', 'huge']));
});

test('the level is recommended from the stack', () => {
  assert.equal(recommendLevel(detect(join(FIXTURES, 'nx-expo'), catalog())).level, 'deep');
  assert.equal(recommendLevel(detect(join(FIXTURES, 'ts-vite'), catalog())).level, 'standard');
  assert.equal(recommendLevel({ techs: [{ id: 'python' }], workspaces: [] }).level, 'lite');
});

test('without --write nothing changes and every file has its diff', () => {
  const project = copy('ts-vite');
  const result = init({ project, claudeHome: claudeHome(), rules: [], modules: [], date: '2026-11-03' });
  assert.equal(result.level, 'standard');
  assert.ok(!existsSync(join(project, '.claude')));
  assert.ok(result.files.every((file) => file.result === 'create' && file.diff.startsWith('--- a/')));
});

test('--write creates the files; a second run keeps an edited generated file and leaves the rest alone', () => {
  const project = copy('ts-vite');
  const args = { project, claudeHome: claudeHome(), level: 'lite', rules: [], modules: [], write: true, date: '2026-11-03' };
  const first = init(args);
  assert.deepEqual(first.files.map((file) => file.result), ['written', 'written', 'written', 'written']);
  assert.ok(!existsSync(join(project, '.claude/settings.json')), 'hecpack never writes settings');
  assert.match(readFileSync(join(project, 'CLAUDE.md'), 'utf8'), /^## hecpack$/m);

  writeFileSync(join(project, '.claude/hecpack/stack.md'), '# Stack\n\nedited by hand\n');
  const second = init(args);
  const byPath = Object.fromEntries(second.files.map((file) => [file.path, file.result]));
  assert.equal(byPath['.claude/hecpack/stack.md'], 'kept');
  assert.equal(byPath['CLAUDE.md'], 'same');
  assert.equal(readFileSync(join(project, '.claude/hecpack/stack.md'), 'utf8'), '# Stack\n\nedited by hand\n');

  const forced = init({ ...args, force: true });
  assert.equal(forced.files.find((file) => file.path === '.claude/hecpack/stack.md').result, 'written');
});

test('project rule files go into the context map and the config; a missing one is an error', () => {
  const project = copy('nx-expo');
  mkdirSync(join(project, '.claude/hecpack/rules'), { recursive: true });
  writeFileSync(join(project, '.claude/hecpack/rules/naming.md'), '# Naming\n\n- kebab-case files\n');
  const result = init({ project, claudeHome: claudeHome(), level: 'standard', rules: ['.claude/hecpack/rules/naming.md'], modules: [], write: true, date: '2026-11-03' });
  const map = JSON.parse(readFileSync(join(project, '.claude/hecpack/context-map.json'), 'utf8'));
  assert.ok(map.types.code.includes('.claude/hecpack/rules/naming.md'));
  assert.ok(map.agents['hecpack:architect'].includes('.claude/hecpack/rules/naming.md'));
  assert.match(readFileSync(join(project, '.claude/hecpack/stack.md'), 'utf8'), /## Project rules\n\n.*\n\n- `\.claude\/hecpack\/rules\/naming\.md`/);
  assert.equal(result.files.length, 5);
  assert.throws(() => init({ project, claudeHome: claudeHome(), rules: ['docs/none.md'], modules: [] }), /rule file not found/);
  assert.throws(() => init({ project, claudeHome: claudeHome(), rules: [], modules: ['format'] }), /unknown module/);
});

test('scan lists the rule documents with their topics and the recommendation', () => {
  const result = scan({ project: join(FIXTURES, 'nx-expo'), claudeHome: claudeHome() });
  assert.equal(result.recommended.level, 'deep');
  const doc = result.docs.find((item) => item.path === '.claude/CLAUDE.md');
  assert.equal(doc.kind, 'instructions');
  assert.ok(result.docs.some((item) => item.path === '.claude/agents/architect.md' && item.kind === 'agent'));
  assert.ok(result.techs.every((tech) => Array.isArray(tech.sources)));
});
