import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { detect } from '../scripts/lib/detect.mjs';
import { findSources, readEnabled, readMarketplaces } from '../scripts/lib/sources.mjs';
import { catalog, claudeHome, FIXTURES, packs } from './helpers.mjs';

const run = (fixture) => {
  const home = claudeHome();
  const detection = detect(join(FIXTURES, fixture), catalog());
  const result = findSources({
    techs: detection.techs,
    packs: packs(),
    plugins: readMarketplaces(home),
    enabled: readEnabled(home, detection.claude.enabledPlugins),
  });
  return Object.fromEntries(result.map((item) => [item.tech, item.sources]));
};

test('a plugin named after the tech wins; an installed one is marked on', () => {
  const sources = run('ts-vite');
  const ts = sources.typescript.find((source) => source.kind === 'plugin');
  assert.equal(ts.id, 'typescript-lsp@claude-plugins-official');
  assert.equal(ts.enabled, true);
  assert.equal(ts.primary, true);
});

test('a mere mention is shown only without a named plugin, and short words never match descriptions', () => {
  const sources = run('ts-vite');
  const react = sources.react.filter((source) => source.kind === 'plugin');
  assert.deepEqual(react.map((source) => source.label), ['expo'], 'one mention, not every plugin that mentions React');
  assert.ok(sources.react.some((source) => source.kind === 'local-skill'), 'React needs UI rules');
  assert.ok(!sources.vitest.some((source) => source.kind === 'local-skill'), 'a test runner needs no skill');
});

test('hecpack packs come first for their stack', () => {
  const sources = run('nx-expo');
  assert.equal(sources.expo[0].id, 'expo-ios-hig');
  assert.equal(sources.nx[0].id, 'nx-monorepo');
  assert.ok(sources.expo.some((source) => source.id === 'expo@claude-plugins-official'));
});
