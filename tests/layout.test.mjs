import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { findWorkspaces, readJson } from '../scripts/lib/detect.mjs';
import { describeLayout, parseJsonc, readLayout } from '../scripts/lib/layout.mjs';

const repo = (t, files) => {
  const root = mkdtempSync(join(tmpdir(), 'layout-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), typeof text === 'string' ? text : JSON.stringify(text));
  }
  return root;
};

const layoutOf = (root) => readLayout(root, findWorkspaces(root, readJson(join(root, 'package.json'))));

test('tsconfig text with comments and trailing commas parses; strings keep their slashes', () => {
  assert.deepEqual(parseJsonc('{\n  // a comment\n  "a": "http://x/*y*/", /* b */\n  "c": [1, 2,],\n}\n'), { a: 'http://x/*y*/', c: [1, 2] });
});

test('aliases come from extends with baseUrl, referenced configs and each package, nearest first', (t) => {
  const root = repo(t, {
    'package.json': { name: 'mono', workspaces: ['apps/*', 'packages/*'] },
    'tsconfig.base.json': { compilerOptions: { paths: { '@acme/ui': ['packages/ui/src/index.ts'], '@shared/*': ['shared/*'] } } },
    'apps/web/package.json': { name: '@acme/web', dependencies: { next: '15.0.0' } },
    // Its own paths replace the inherited ones, and resolve from its folder (no baseUrl).
    'apps/web/tsconfig.json': { extends: '../../tsconfig.base.json', compilerOptions: { paths: { '@/*': ['./src/*'] } } },
    'apps/web/src/legacy/tsconfig.json': { compilerOptions: { baseUrl: '.' } },
    // Extends the base without paths of its own: the base's paths, resolved from the base's folder.
    'packages/kit/tsconfig.json': { extends: '../../tsconfig.base.json' },
    'apps/web/app/page.tsx': '',
    'apps/admin/package.json': { name: '@acme/admin', dependencies: { vite: '6.0.0' } },
    'apps/admin/tsconfig.json': { files: [], references: [{ path: './tsconfig.app.json' }] },
    'apps/admin/tsconfig.app.json': { compilerOptions: { baseUrl: 'src', paths: { '~/*': ['*'] } } },
    'packages/ui/package.json': { name: '@acme/ui', exports: { '.': { types: './dist/index.d.ts', default: './src/index.ts' } } },
    'packages/ui/src/index.ts': '',
    'packages/kit/package.json': { name: '@acme/kit', main: 'dist/index.js' },
  });
  const layout = layoutOf(root);
  const patterns = (path) => layout.aliasesFor(path).map((alias) => `${alias.pattern} → ${alias.targets.join(' | ')}`);
  assert.deepEqual(patterns('apps/web/src/a.ts'), [
    '@/* → apps/web/src/*',
    '@acme/admin/* → apps/admin/*',
    '@acme/web/* → apps/web/*',
    '@acme/kit/* → packages/kit/*',
    '@acme/ui → packages/ui/src/index.ts',
  ]);
  assert.deepEqual(patterns('apps/admin/src/a.ts').slice(0, 1), ['~/* → apps/admin/src/*']);
  assert.deepEqual(patterns('packages/kit/src/a.ts').slice(0, 2), ['@acme/ui → packages/ui/src/index.ts', '@shared/* → shared/*']);
  // A folder without a config of its own takes the root's.
  assert.deepEqual(patterns('tools/gen.ts').slice(0, 2), ['@acme/ui → packages/ui/src/index.ts', '@shared/* → shared/*']);
  // The entry is the source file the manifest names, not its build output.
  assert.deepEqual(layout.packages.map((item) => [item.dir, item.entry]), [
    ['.', null],
    ['apps/admin', null],
    ['apps/web', null],
    ['packages/kit', null],
    ['packages/ui', 'packages/ui/src/index.ts'],
  ]);
  assert.deepEqual([...layout.libs], [['packages/ui', { alias: '@acme/ui', index: 'packages/ui/src/index.ts' }]]);
  assert.deepEqual(layout.routes, ['apps/web/app']);
  assert.deepEqual(layout.platforms, []);
  assert.equal(layout.resolveAlias('apps/web/src/a.ts', '@/lib/cn').target, 'apps/web/src/lib/cn');
  assert.equal(layout.expressAlias('apps/web/src/a.ts', 'apps/web/src/ui/Button'), '@/ui/Button');
  // A deep import into another package is never made up: only the alias the import already used.
  assert.equal(layout.expressAlias('apps/web/src/a.ts', 'packages/kit/src/x'), null);
  const section = describeLayout(layout).join('\n');
  assert.match(section, /^## Layout\n/);
  assert.match(section, /`packages\/ui` \(@acme\/ui, entry `packages\/ui\/src\/index\.ts`\)/);
  assert.match(section, /`@\/\*` → `apps\/web\/src\/\*` in `apps\/web`/);
  assert.match(section, /Route folders: `apps\/web\/app`; a file path there is a URL/);
});

test('React Native turns platform suffixes on; config.json overrides what detection finds', (t) => {
  const root = repo(t, {
    'package.json': { name: 'app', dependencies: { expo: '54.0.0', 'expo-router': '6.0.0' } },
    'app/index.tsx': '',
  });
  const layout = layoutOf(root);
  assert.deepEqual(layout.platforms, ['ios', 'android', 'native', 'web']);
  assert.deepEqual(layout.routes, ['app']);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'app', dependencies: { expo: '54.0.0' } }));
  mkdirSync(join(root, '.claude/hecpack'), { recursive: true });
  writeFileSync(join(root, '.claude/hecpack/config.json'), JSON.stringify({ layout: { platforms: ['ios', 'android', 'next'], routes: ['src/screens'] } }));
  const fixed = layoutOf(root);
  assert.deepEqual(fixed.platforms, ['ios', 'android', 'next']);
  assert.deepEqual(fixed.routes, ['src/screens']);
});
