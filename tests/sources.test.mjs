import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { detect } from '../scripts/lib/detect.mjs';
import { enabledFor, findSources, readEnabled } from '../scripts/lib/sources.mjs';
import { catalog, claudeHome, FIXTURES, packs } from './helpers.mjs';

const run = (fixture, extra = []) => {
  const home = claudeHome();
  const detection = detect(join(FIXTURES, fixture), catalog());
  const enabled = readEnabled(home, detection.claude.enabledPlugins);
  for (const id of extra) enabled.add(id);
  const result = findSources({ techs: detection.techs, packs: packs(), enabled });
  return Object.fromEntries(result.map((item) => [item.tech, item.sources]));
};

test('only hecpack packs, context7 and the local skill are proposed: no marketplace plugin is suggested', () => {
  const sources = run('ts-vite');
  const kinds = new Set(Object.values(sources).flat().map((source) => source.kind));
  assert.ok(!Object.values(sources).flat().some((source) => source.kind === 'plugin' && !source.enabled), 'nothing to install');
  assert.ok(!Object.values(sources).flat().some((source) => 'install' in source || 'match' in source));
  assert.ok(sources.react.some((source) => source.kind === 'local-skill'), 'React needs UI rules');
  assert.ok(!sources.vitest.some((source) => source.kind === 'local-skill'), 'a test runner needs no skill');
  assert.ok(kinds.has('docs'));
});

test('a plugin already on counts only when named after the technology, never by a word inside its name', () => {
  const sources = run('ts-vite', ['ui5-typescript-conversion@community', 'react-best-practices@community']);
  const ts = sources.typescript.filter((source) => source.kind === 'plugin');
  assert.deepEqual(ts.map((source) => source.id), ['typescript-lsp@claude-plugins-official']);
  assert.equal(ts[0].enabled, true);
  assert.deepEqual(sources.react.filter((source) => source.kind === 'plugin').map((source) => source.id), ['react-best-practices@community']);
  assert.ok(!sources.react.some((source) => source.kind === 'local-skill'), 'covered by the plugin that is on');
  const tech = { search: ['typescript', 'ts'] };
  assert.deepEqual(enabledFor(tech, new Set(['ui5-typescript-conversion@x', 'TypeScript-tools@x'])), ['TypeScript-tools@x']);
});

test('hecpack packs come first for their stack', () => {
  const sources = run('nx-expo');
  assert.equal(sources.expo[0].id, 'expo-ios-hig');
  assert.equal(sources.nx[0].id, 'nx-monorepo');
});
