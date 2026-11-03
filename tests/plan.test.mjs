import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { detect } from '../scripts/lib/detect.mjs';
import { plan, warnings } from '../scripts/lib/plan.mjs';
import { findSources } from '../scripts/lib/sources.mjs';
import { catalog, FIXTURES, packs, PLUGIN } from './helpers.mjs';

const setup = (fixture, level, techIds) => {
  const root = join(FIXTURES, fixture);
  const detection = detect(root, catalog());
  const sources = findSources({ techs: detection.techs, packs: packs(), plugins: [], enabled: new Set() });
  const readProject = (path) => (existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : undefined);
  return { detection, files: plan({ detection, sources, level, techIds, readProject, date: '2026-11-03' }) };
};

const file = (files, path) => files.find((item) => item.path === path);

test('lite writes no project map and loads only triage from the workflow', () => {
  const { files } = setup('ts-vite', 'lite');
  assert.deepEqual(files.map((item) => item.path), [
    '.claude/hecpack/config.json', '.claude/hecpack/context-map.json', '.claude/hecpack/stack.md', 'CLAUDE.md',
  ]);
  const map = JSON.parse(file(files, '.claude/hecpack/context-map.json').content);
  assert.ok(map.types.code.includes('hecpack:core/workflow.md#Triage'));
  assert.deepEqual(Object.keys(map.agents), ['hecpack:checker']);
});

test('every hecpack: path in every level points to a real file and heading', () => {
  for (const level of ['lite', 'standard', 'deep']) {
    const { files } = setup('nx-expo', level);
    const map = JSON.parse(file(files, '.claude/hecpack/context-map.json').content);
    const specs = [...Object.values(map.types), ...Object.values(map.agents)].flat().filter((spec) => spec.startsWith('hecpack:'));
    for (const spec of specs) {
      const [path, heading] = spec.slice('hecpack:'.length).split('#');
      const text = readFileSync(join(PLUGIN, path), 'utf8');
      if (heading) assert.ok(text.includes(`\n## ${heading}\n`), `${level}: ${spec}`);
    }
    for (const agent of Object.keys(map.agents)) {
      assert.ok(existsSync(join(PLUGIN, 'agents', `${agent.split(':')[1]}.md`)), agent);
    }
  }
});

test('the existing CLAUDE.md gets one section appended; stack.md has Validation for the checker', () => {
  const { files } = setup('nx-expo', 'standard');
  const claude = file(files, '.claude/CLAUDE.md');
  assert.equal(claude.action, 'update');
  assert.ok(claude.content.startsWith('# Project rules\n'));
  assert.equal(claude.content.match(/## hecpack/g).length, 1);
  assert.match(file(files, '.claude/hecpack/stack.md').content, /## Validation\n\n- typecheck \+ lint \+ test: `npx nx run-many/);
  assert.match(file(files, '.claude/hecpack/project-map.md').content, /## apps\/mobile \(@demo\/mobile\)\n\nThe phone app/);
});

test('deselected techs leave stack.md and config', () => {
  const { files } = setup('ts-vite', 'standard', ['typescript', 'react']);
  const config = JSON.parse(file(files, '.claude/hecpack/config.json').content);
  assert.deepEqual(config.techs, ['typescript', 'react']);
  assert.doesNotMatch(file(files, '.claude/hecpack/stack.md').content, /Vite/);
});

test('overlaps with an existing setup are named', () => {
  const { detection } = setup('nx-expo', 'standard');
  assert.deepEqual(warnings(detection.claude).map((item) => item.id), ['hooks', 'agents']);
});
