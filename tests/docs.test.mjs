import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { findDocs, topicsOf } from '../scripts/lib/docs.mjs';
import { scratch } from './helpers.mjs';

const write = (root, path, text) => {
  mkdirSync(join(root, path, '..'), { recursive: true });
  writeFileSync(join(root, path), text);
};

test('instruction files, rule folders, agents, skills and named docs are found once each, in that order', () => {
  const root = scratch();
  write(root, 'CLAUDE.md', '# Rules\n\nReply in English. Run `npm test` before a commit.\n\n## Git\n\nNever push.\n');
  write(root, 'AGENTS.md', '# Agents\n');
  write(root, '.cursorrules', 'Use tabs.');
  write(root, '.claude/rules/naming.md', '# Naming\n\nkebab-case folders.\n');
  write(root, '.claude/agents/reviewer.md', '---\nname: reviewer\n---\nReview.');
  write(root, '.claude/skills/deploy/SKILL.md', '---\nname: deploy\n---\nDeploy.');
  write(root, 'docs/CONTRIBUTING.md', '# Contributing\n\nOpen a pull request.\n');
  write(root, 'docs/changelog.md', '# Changelog\n');
  write(root, 'apps/web/AGENTS.md', '# Web agents\n');
  write(root, 'node_modules/x/CLAUDE.md', 'nope');
  const docs = findDocs(root, ['apps/web']);
  assert.deepEqual(docs.map((doc) => doc.path), [
    'CLAUDE.md', 'AGENTS.md', '.cursorrules', 'apps/web/AGENTS.md', '.claude/rules/naming.md',
    '.claude/agents/reviewer.md', '.claude/skills/deploy/SKILL.md', 'docs/CONTRIBUTING.md',
  ]);
  const claude = docs[0];
  assert.equal(claude.kind, 'instructions');
  assert.deepEqual(claude.headings, ['Rules', 'Git']);
  assert.ok(claude.topics.includes('language') && claude.topics.includes('git') && claude.topics.includes('validation'));
  assert.equal(docs.find((doc) => doc.path === '.claude/rules/naming.md').kind, 'rules');
  assert.equal(docs.find((doc) => doc.path === 'docs/CONTRIBUTING.md').kind, 'doc');
});

test('topics are found in Russian too', () => {
  assert.deepEqual(topicsOf('Отвечай на русском. Коммит делает пользователь.'), ['language', 'git']);
});

test('a project without documents gives an empty list', () => {
  assert.deepEqual(findDocs(scratch()), []);
});
