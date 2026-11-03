import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { loadTypeScript } from '../scripts/lib/code/typescript.mjs';
import { runAdopt, runAudit, runCheck } from '../scripts/arch.mjs';

const skip = !loadTypeScript(process.cwd()) && 'no TypeScript package to parse with (npm i -g typescript or HECPACK_TYPESCRIPT)';

// A feature-sliced app with one of each problem the audit looks for (shared/ui/Button importing a store
// is both a layer-up and a dumb-smart break).
const APP = {
  'package.json': JSON.stringify({ name: 'shop', dependencies: { axios: '1.0.0', ky: '1.0.0', react: '19.0.0' } }),
  'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '@/*': ['./src/*'] } } }),
  'src/main.tsx': `import { App } from './app/App';\n\nexport default App;\n`,
  'src/app/App.tsx': `import { Home } from '@/pages/home/Home';\n\nexport const App = Home;\n`,
  'src/pages/home/Home.tsx': `import { Header } from '@/widgets/header/Header';\nimport { Cart } from '@/features/cart/Cart';\n\nexport const Home = [Header, Cart];\n`,
  'src/widgets/header/Header.tsx': `import { Big } from '@/shared/ui/Big';\nimport { Button } from '@/shared/ui/Button';\n\nexport const Header = [Big, Button];\n`,
  'src/features/cart/Cart.tsx': `import axios from 'axios';\nimport { useUser } from '../auth/useUser';\nimport { product } from '@/entities/product/model';\nimport { a } from './a';\n\nexport const Cart = [axios, useUser, product, a];\n`,
  'src/features/cart/a.ts': `import { b } from './b';\n\nexport const a = () => b;\n`,
  'src/features/cart/b.ts': `import { a } from './a';\n\nexport const b = () => a;\n`,
  'src/features/cart/old.ts': `export const old = 1;\n`,
  'src/features/auth/useUser.ts': `import ky from 'ky';\n\nexport const useUser = ky;\n`,
  'src/entities/product/model.ts': `import { Cart } from '@/features/cart/Cart';\n\nexport const product = Cart;\n`,
  'src/entities/product/store/productStore.ts': `export const productStore = 1;\n`,
  'src/shared/ui/Button.tsx': `import { productStore } from '@/entities/product/store/productStore';\n\nexport const Button = productStore;\n`,
  'src/shared/lib/format.ts': `import { Button } from '../ui/Button';\n\nexport const format = Button;\n`,
  'src/shared/ui/Big.tsx': `export const Big = 1;\n${'// line\n'.repeat(160)}`,
};

const repo = (t, files) => {
  const root = mkdtempSync(join(tmpdir(), 'arch-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
};

const files = (root) => readdirSync(root, { recursive: true }).sort();

const ARCHITECTURE = (block) => `# Architecture\n\n## Check\n\n\`\`\`hecpack-arch\n${block}\n\`\`\`\n`;

test('the audit infers the layers and finds one of each problem', { skip }, (t) => {
  const root = repo(t, APP);
  const before = files(root);
  const summary = runAudit(root);
  assert.deepEqual(files(root), before, 'the audit writes nothing into the project');
  assert.equal(summary.rules, 'inferred from folder names');
  assert.deepEqual(summary.layers, [
    'app: src/app',
    'pages: src/pages/*',
    'widgets (slices apart): src/widgets/*',
    'features (slices apart): src/features/*',
    'entities: src/entities/*',
    'shared: src/shared/*',
  ]);
  assert.deepEqual(summary.sharedUi, ['src/shared/ui']);
  const counts = Object.fromEntries(Object.entries(summary.breaks).map(([rule, { count }]) => [rule, count]));
  assert.deepEqual(counts, { 'layer-up': 2, sideways: 1, 'dumb-smart': 1, 'leaf-up': 1, 'kit-size': 1 });
  assert.match(summary.breaks['layer-up'].top[0], /^src\/entities\/product\/model\.ts:1 → src\/features\/cart\/Cart\.tsx \(entities imports features/);
  assert.match(summary.breaks['dumb-smart'].top[0], /^src\/shared\/ui\/Button\.tsx:1 → .*\(shared UI imports store code\)/);
  assert.match(summary.breaks.sideways.top[0], /^src\/features\/cart\/Cart\.tsx:2 → src\/features\/auth\/useUser\.ts/);
  assert.match(summary.breaks['leaf-up'].top[0], /lib imports ui: leaves stay leaves/);
  assert.equal(summary.cycles.count, 2);
  assert.ok(summary.cycles.top.some((line) => line.startsWith('2 files: src/features/cart/a.ts → src/features/cart/b.ts → src/features/cart/a.ts')));
  assert.deepEqual(summary.unused.top, ['src/features/cart/old.ts', 'src/shared/lib/format.ts']);
  assert.deepEqual(summary.twoTools, [{ job: 'data fetching', used: ['axios (1 files)', 'ky (1 files)'] }]);
  assert.ok(summary.readFirst.includes('src/entities/product/model.ts'));
  assert.equal(summary.proposedRules.layers.length, 6);
});

test('in a monorepo the layers come from the packages; an e2e package and a slice named core hold none', { skip }, (t) => {
  const pkg = (name) => JSON.stringify({ name });
  const root = repo(t, {
    'package.json': JSON.stringify({ name: 'mono', private: true, workspaces: ['apps/*', 'libs/*'] }),
    'apps/web/package.json': pkg('web'),
    'apps/web/src/app/page.tsx': `import { list } from 'features/list';\n\nexport default list;\n`,
    'apps/web-e2e/package.json': pkg('web-e2e'),
    'apps/web-e2e/src/home.ts': `export const home = 1;\n`,
    'libs/features/package.json': JSON.stringify({ name: 'features', exports: { '.': './src/index.ts' } }),
    'libs/features/src/index.ts': `export * from './list/list';\n`,
    'libs/features/src/list/list.ts': `import { base } from 'core';\nimport { inner } from '../core/inner';\n\nexport const list = [base, inner];\n`,
    'libs/features/src/core/inner.ts': `export const inner = 1;\n`,
    'libs/core/package.json': JSON.stringify({ name: 'core', exports: { '.': './src/index.ts' } }),
    'libs/core/src/index.ts': `export * from './base/base';\n`,
    'libs/core/src/base/base.ts': `export const base = 1;\n`,
  });
  assert.deepEqual(runAudit(root).layers, ['app: apps/web', 'features (slices apart): libs/features/src/*', 'shared: libs/core/src/*']);
});

test('the check holds the touched files to the accepted rules; allow takes an exception with its why', { skip }, (t) => {
  const root = repo(t, APP);
  const block = (allow) =>
    JSON.stringify({ layers: [{ name: 'features', paths: ['src/features/*'], isolated: true }, { name: 'entities', paths: ['src/entities/*'] }], roles: false, allow });
  mkdirSync(join(root, '.claude/hecpack'), { recursive: true });
  writeFileSync(join(root, '.claude/hecpack/architecture.md'), ARCHITECTURE(block([])));
  const before = files(root);
  const touched = runCheck(root, ['src/entities/product/model.ts']);
  assert.deepEqual(files(root), before, 'the check writes nothing into the project');
  assert.equal(touched.exitCode, 1);
  assert.deepEqual(touched.lines, [
    'error layer-up: src/entities/product/model.ts:1 → src/features/cart/Cart.tsx (entities imports features, a layer above it)',
    'error cycle: src/entities/product/model.ts (2 files: src/entities/product/model.ts → src/features/cart/Cart.tsx → src/entities/product/model.ts)',
    'arch: 2 errors, 0 warnings, 1 files checked',
  ]);
  assert.equal(runCheck(root, ['src/app/App.tsx']).exitCode, 0);
  writeFileSync(
    join(root, '.claude/hecpack/architecture.md'),
    ARCHITECTURE(block([{ from: 'src/features/cart/**', to: 'src/features/auth/useUser.ts', why: 'the cart needs the signed-in user' }])),
  );
  assert.ok(!runCheck(root, ['src/features/cart/Cart.tsx']).lines.some((line) => line.includes('sideways')));
});

test('adopting puts architecture.md next to stack.md for code sessions and the architect, once', (t) => {
  const root = repo(t, {
    '.claude/hecpack/architecture.md': ARCHITECTURE('{}'),
    '.claude/hecpack/context-map.json': JSON.stringify({
      types: { q: ['.claude/hecpack/stack.md'], code: ['hecpack:core/code.md', '.claude/hecpack/stack.md', '.claude/hecpack/project-map.md'] },
      agents: { 'hecpack:architect': ['hecpack:core/code.md', '.claude/hecpack/stack.md'], 'hecpack:checker': ['.claude/hecpack/stack.md'] },
    }),
  });
  assert.deepEqual(runAdopt(root).lines, ['arch: .claude/hecpack/architecture.md added to 2 lists of the context map']);
  const map = JSON.parse(readFileSync(join(root, '.claude/hecpack/context-map.json'), 'utf8'));
  assert.deepEqual(map.types.code, ['hecpack:core/code.md', '.claude/hecpack/stack.md', '.claude/hecpack/architecture.md', '.claude/hecpack/project-map.md']);
  assert.deepEqual(map.agents['hecpack:checker'], ['.claude/hecpack/stack.md']);
  assert.deepEqual(map.types.q, ['.claude/hecpack/stack.md']);
  assert.deepEqual(runAdopt(root).lines, ['arch: .claude/hecpack/architecture.md is already in the context map']);
});
