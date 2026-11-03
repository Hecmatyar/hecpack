import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { detect } from '../scripts/lib/detect.mjs';
import { catalog, FIXTURES } from './helpers.mjs';

const ids = (result) => result.techs.map((tech) => tech.id);

test('a plain TypeScript + Vite app: techs, script-based validation, src folders', () => {
  const result = detect(join(FIXTURES, 'ts-vite'), catalog());
  assert.deepEqual(ids(result).sort(), ['eslint', 'react', 'typescript', 'vite', 'vitest']);
  assert.equal(result.techs.find((tech) => tech.id === 'react').version, '19.0.0');
  assert.deepEqual(result.validation.map((item) => item.command), ['npx tsc --noEmit', 'npm run lint', 'npm run test']);
  assert.deepEqual(result.workspaces, []);
  assert.deepEqual(result.folders[0].children, ['src/components', 'src/pages']);
  assert.equal(result.claude.claudeMd.length, 0);
});

test('an Nx + Expo monorepo: workspaces, app.json evidence, nx validation, existing Claude setup', () => {
  const result = detect(join(FIXTURES, 'nx-expo'), catalog());
  assert.deepEqual(result.workspaces, ['apps/mobile', 'libs/ui']);
  assert.ok(ids(result).includes('expo') && ids(result).includes('nx') && !ids(result).includes('javascript'));
  assert.ok(result.techs.find((tech) => tech.id === 'expo').evidence.includes('"expo" in apps/mobile/app.json'));
  assert.equal(result.validation[0].command, 'npx nx run-many -t typecheck lint test');
  assert.equal(result.folders[0].description, 'The phone app');
  assert.deepEqual(result.claude.claudeMd, ['.claude/CLAUDE.md']);
  assert.deepEqual(result.claude.agents, ['architect']);
  assert.deepEqual(result.claude.hookEvents, ['UserPromptSubmit']);
});
