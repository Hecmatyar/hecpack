import assert from 'node:assert/strict';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { contextTree, duplicates, linkGraph, specText, tok } from '../scripts/lib/context-tree.mjs';
import { run } from '../scripts/context-tree.mjs';
import { init } from '../scripts/init.mjs';
import { claudeHome, FIXTURES, PLUGIN, scratch } from './helpers.mjs';

const setUp = () => {
  const project = scratch();
  cpSync(join(FIXTURES, 'ts-vite'), project, { recursive: true });
  init({ project, claudeHome: claudeHome(), level: 'standard', rules: [], modules: [], write: true, date: '2026-11-03' });
  mkdirSync(join(project, '.claude/rules'), { recursive: true });
  mkdirSync(join(project, 'docs'), { recursive: true });
  mkdirSync(join(project, 'src/ui'), { recursive: true });
  writeFileSync(join(project, '.claude/rules/ui.md'), "---\npaths:\n  - 'src/**/*.tsx'\n---\n# UI\n\nUse tokens.\n");
  writeFileSync(join(project, '.claude/rules/always.md'), '# Always\n\nShort replies.\n');
  writeFileSync(join(project, 'src/ui/CLAUDE.md'), '# UI folder\n\nComponents only.\n');
  writeFileSync(join(project, 'docs/tokens.md'), `# Tokens\n\n${'Colour tokens live in src/theme and every screen uses them by name never by value.\n'.repeat(20)}`);
  writeFileSync(join(project, '.claude/design-notes.md'), '# Design\n\nRead docs/tokens.md when you change colours.\n');
  writeFileSync(join(project, '.claude/old-notes.md'), '# Old\n\nnothing\n');
  writeFileSync(join(project, 'CLAUDE.md'), `${readFileSync(join(project, 'CLAUDE.md'), 'utf8')}\nDesign rules: .claude/design-notes.md, read before UI work.\n@docs/imported.md\n`);
  writeFileSync(join(project, 'docs/imported.md'), '# Imported\n\nLoaded with CLAUDE.md.\n');
  return project;
};

test('spec text keeps one section or the top level of a list', () => {
  const files = { 'a.md': { text: '# A\n\n## One\n- x\n  - y\n## Two\nz\n' } };
  assert.equal(specText(files, 'a.md#One').text, '## One\n- x\n  - y');
  assert.equal(specText(files, 'a.md#One~top').text, '## One\n- x');
  assert.equal(specText(files, 'a.md#None').missing, true);
  assert.equal(tok('12345678'), 2);
});

test('links resolve by the file\'s folder, by path suffix and by a unique basename', () => {
  const files = {
    '.claude/docs/a.md': { text: 'see b.md and `.claude/docs/sub/c.md`, also ./sub/c.md' },
    '.claude/docs/b.md': { text: '' },
    '.claude/docs/sub/c.md': { text: 'back to ../a.md' },
    'x/README.md': { text: '' },
    'y/README.md': { text: 'README.md is ambiguous' },
    'hecpack:core/session.md': { text: 'core/workflow.md' },
    'hecpack:core/workflow.md': { text: '' },
  };
  const { graph } = linkGraph(files);
  assert.deepEqual([...graph['.claude/docs/a.md']].sort(), ['.claude/docs/b.md', '.claude/docs/sub/c.md']);
  assert.deepEqual([...graph['.claude/docs/sub/c.md']], ['.claude/docs/a.md']);
  assert.deepEqual([...graph['y/README.md']], []);
  assert.deepEqual([...graph['hecpack:core/session.md']], ['hecpack:core/workflow.md']);
});

test('a set-up project: modes and agents with their start and link sets, path rules, orphans', () => {
  const project = setUp();
  const tree = contextTree({ root: project, claudeHome: claudeHome(), pluginRoot: PLUGIN });
  assert.equal(tree.hecpack, true);
  const code = tree.readers.find((reader) => reader.id === 'main:code');
  const start = code.must.map((entry) => entry.p);
  for (const path of ['CLAUDE.md', 'docs/imported.md', '.claude/rules/always.md', 'hecpack:core/workflow.md', '.claude/hecpack/stack.md', '(agent descriptions)']) assert.ok(start.includes(path), path);
  assert.ok(!start.includes('.claude/rules/ui.md'), 'a rule with paths loads by path, not at start');
  assert.equal(code.must.find((entry) => entry.p === 'CLAUDE.md').src, 'claude');
  assert.equal(code.must.find((entry) => entry.p === '.claude/hecpack/stack.md').src, 'hook');
  const notes = code.optional.find((entry) => entry.p === '.claude/design-notes.md');
  assert.match(notes.when, /read before UI work/);
  assert.ok(code.worstTok >= code.optionalTok + tok(readFileSync(join(project, 'docs/tokens.md'), 'utf8')), 'the worst case follows links further');
  assert.equal(code.mustTok, code.must.reduce((sum, entry) => sum + entry.tok, 0));

  const architect = tree.readers.find((reader) => reader.id === 'agent:hecpack:architect');
  assert.equal(architect.must.find((entry) => entry.src === 'agent').p, 'hecpack:agents/architect.md');
  assert.ok(!architect.must.some((entry) => entry.p === '(agent descriptions)'), 'agents do not get the agent list');

  assert.deepEqual(tree.pathRules.map((rule) => rule.p).sort(), ['.claude/rules/ui.md', 'src/ui/CLAUDE.md']);
  assert.deepEqual(tree.orphans.map((row) => row.p), ['.claude/old-notes.md']);
  assert.ok(tree.heavy[0].cost >= tree.heavy.at(-1).cost);
  assert.deepEqual(tree.missing, []);
});

test('without hecpack the main session shows what Claude Code loads by itself, and project agents', () => {
  const tree = contextTree({ root: join(FIXTURES, 'nx-expo'), claudeHome: claudeHome(), pluginRoot: PLUGIN });
  assert.equal(tree.hecpack, false);
  assert.deepEqual(tree.readers.map((reader) => reader.id), ['main', 'agent:architect']);
  assert.ok(!tree.files.some((row) => row.p.startsWith('hecpack:agents/')), 'hecpack agents are not listed where hecpack is not set up');
});

test('duplicates need a real share of repeated phrases', () => {
  const same = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen';
  const files = { 'a.md': { text: `${same}\nother words here` }, 'b.md': { text: `intro\n${same}` }, 'c.md': { text: 'nothing in common at all with the others really' } };
  const pairs = duplicates(files, ['a.md', 'b.md', 'c.md']);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].a, 'a.md');
  assert.ok(pairs[0].pct >= 50);
});

test('the page is written outside the project and the history shows the change', () => {
  const project = setUp();
  const out = scratch();
  const first = run({ project, out, claudeHome: claudeHome(), date: '2026-11-01T10:00:00Z' });
  assert.equal(first.report.previous, undefined);
  const html = readFileSync(first.html, 'utf8');
  assert.ok(!html.includes('/*__REPORT__*/null'));
  assert.ok(html.includes('<html lang="en">'));
  writeFileSync(join(project, '.claude/rules/always.md'), `# Always\n\n${'More text. '.repeat(200)}\n`);
  const second = run({ project, out, claudeHome: claudeHome(), date: '2026-11-03T10:00:00Z' });
  const before = second.report.previous.readers['main:code'][0];
  assert.ok(second.report.readers.find((reader) => reader.id === 'main:code').mustTok > before);
  const third = run({ project, out, claudeHome: claudeHome(), date: '2026-11-04T10:00:00Z' });
  assert.equal(third.report.previous.at, '2026-11-01T10:00:00', 'an unchanged run compares with the last change');
});
