import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { findWorkspaces, readJson } from '../scripts/lib/detect.mjs';
import { readLayout } from '../scripts/lib/layout.mjs';
import { move } from '../scripts/lib/move/move.mjs';
import { loadTypeScript } from '../scripts/lib/move/typescript.mjs';
import { parseOptions } from '../scripts/move.mjs';

// The parser is the project's TypeScript; here a global install or HECPACK_TYPESCRIPT.
const skip = !loadTypeScript(process.cwd()) && 'no TypeScript package to parse with (npm i -g typescript or HECPACK_TYPESCRIPT)';

// An Nx-style monorepo: two libs with exact aliases to their entries, apps without.
const MONOREPO = {
  'package.json': JSON.stringify({ name: 'demo', workspaces: ['apps/*', 'libs/*'], dependencies: { 'react-native': '0.81.0' } }),
  'tsconfig.base.json': JSON.stringify({
    compilerOptions: { paths: { '@demo/a': ['./libs/a/src/index.ts'], '@demo/b': ['./libs/b/src/index.ts'] } },
  }),
  'libs/a/project.json': '{ "name": "a" }',
  'libs/b/project.json': '{ "name": "b" }',
  'apps/app/project.json': '{ "name": "app" }',
};

// A fresh mini repo per test, removed after it.
const repo = (t, files, base = MONOREPO) => {
  const root = mkdtempSync(join(tmpdir(), 'move-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, text] of Object.entries({ ...base, ...files })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
};

const run = (root, moves, options = {}) =>
  move({
    root,
    layout: readLayout(root, findWorkspaces(root, readJson(join(root, 'package.json')))),
    moves: moves.map(([from, to]) => ({ from, to })),
    format: false,
    ...options,
  });

const read = (root, path) => readFileSync(join(root, path), 'utf8');
const exists = (root, path) => existsSync(join(root, path));

// Every path under root → its text, or '/' for a folder.
const snapshot = (root) =>
  Object.fromEntries(
    readdirSync(root, { recursive: true })
      .sort()
      .map((path) => [path, statSync(join(root, path)).isDirectory() ? '/' : read(root, path)]),
  );

const CARDS = {
  'libs/a/src/cards/Card.tsx': `import { helper } from '../lib/helper';
import { CardRow } from './CardRow';

export const Card = () => [helper, CardRow];
`,
  'libs/a/src/cards/CardRow.tsx': `export const CardRow = 1;\n`,
  'libs/a/src/lib/helper.ts': `export const helper = 1;\n`,
  'libs/a/src/screens/Screen.tsx': `import { Card } from "../cards/Card";\n\nexport const Screen = Card;\n`,
};

const NX = [{ check: 'typecheck + lint', command: 'npx nx run-many -t typecheck lint', scoped: 'npx nx run-many -t typecheck lint -p <project>' }];

test('a folder move rewrites importers left behind and the moved files outward links', { skip }, (t) => {
  const root = repo(t, CARDS);
  const { exitCode, lines } = run(root, [['libs/a/src/cards', 'libs/a/src/blocks/card']], { validation: NX });
  assert.equal(exitCode, 0);
  assert.equal(read(root, 'libs/a/src/screens/Screen.tsx'), `import { Card } from "../blocks/card/Card";\n\nexport const Screen = Card;\n`);
  assert.equal(
    read(root, 'libs/a/src/blocks/card/Card.tsx'),
    `import { helper } from '../../lib/helper';
import { CardRow } from './CardRow';

export const Card = () => [helper, CardRow];
`,
  );
  assert.ok(!exists(root, 'libs/a/src/cards'));
  assert.deepEqual(lines, [
    'move libs/a/src/cards → libs/a/src/blocks/card (2 files)',
    'edited libs/a/src/blocks/card/Card.tsx',
    'edited libs/a/src/screens/Screen.tsx',
    'next: npx nx run-many -t typecheck lint -p a',
  ]);
});

test('a module group moves and renames its base, platform files and tests', { skip }, (t) => {
  const root = repo(t, {
    'libs/a/src/buttons/button/Button.tsx': `export const Button = 1;\n`,
    'libs/a/src/buttons/button/Button.ios.tsx': `import type { IButtonProps } from './Button';
import { tokens } from '../../theme/tokens';

export const Button = tokens as IButtonProps;
`,
    'libs/a/src/buttons/button/Button.web.tsx': `export const Button = 2;\n`,
    'libs/a/src/buttons/button/Button.test.tsx': `import { Button } from './Button';\n\ntest('button', () => Button);\n`,
    'libs/a/src/buttons/button/Button.stories.tsx': `import { Button } from './Button';\n\nexport default { component: Button };\n`,
    'libs/a/src/buttons/button/ButtonGroup.tsx': `import { Button } from './Button';\n\nexport const ButtonGroup = Button;\n`,
    'libs/a/src/theme/tokens.ts': `export const tokens = 1;\n`,
    'libs/a/src/screens/Screen.tsx': `import { Button } from '../buttons/button/Button';\n`,
  });
  const { exitCode, lines } = run(root, [['libs/a/src/buttons/button/Button.ios.tsx', 'libs/a/src/controls/actions/action/Action.ios.tsx']]);
  assert.equal(exitCode, 0);
  assert.deepEqual(readdirSync(join(root, 'libs/a/src/controls/actions/action')).sort(), [
    'Action.ios.tsx',
    'Action.stories.tsx',
    'Action.test.tsx',
    'Action.tsx',
    'Action.web.tsx',
  ]);
  assert.deepEqual(readdirSync(join(root, 'libs/a/src/buttons/button')), ['ButtonGroup.tsx']);
  assert.equal(lines.filter((line) => line.startsWith('move ')).length, 5, lines.join('\n'));
  assert.equal(
    read(root, 'libs/a/src/controls/actions/action/Action.ios.tsx'),
    `import type { IButtonProps } from './Action';
import { tokens } from '../../../theme/tokens';

export const Button = tokens as IButtonProps;
`,
  );
  assert.equal(read(root, 'libs/a/src/controls/actions/action/Action.test.tsx'), `import { Button } from './Action';\n\ntest('button', () => Button);\n`);
  assert.equal(
    read(root, 'libs/a/src/buttons/button/ButtonGroup.tsx'),
    `import { Button } from '../../controls/actions/action/Action';\n\nexport const ButtonGroup = Button;\n`,
  );
  assert.equal(read(root, 'libs/a/src/screens/Screen.tsx'), `import { Button } from '../controls/actions/action/Action';\n`);
});

test('without React Native a platform-like suffix is just a name', { skip }, (t) => {
  const root = repo(t, {
    'package.json': JSON.stringify({ name: 'web' }),
    'src/api.ts': `export const api = 1;\n`,
    'src/api.web.ts': `export const web = 1;\n`,
  }, {});
  run(root, [['src/api.ts', 'src/net/api.ts']]);
  assert.deepEqual(readdirSync(join(root, 'src')).sort(), ['api.web.ts', 'net']);
});

test('an asset moves with its density variants', { skip }, (t) => {
  const root = repo(t, {
    'libs/a/src/navigation/icons/home.png': '1x',
    'libs/a/src/navigation/icons/home@2x.png': '2x',
    'libs/a/src/navigation/icons/home@3x.png': '3x',
    'libs/a/src/navigation/icons/homeFilled.png': 'filled',
    'libs/a/src/navigation/Navigation.ios.tsx': `export const icon = require('./icons/home.png');\n`,
  });
  const { exitCode } = run(root, [['libs/a/src/navigation/icons/home@2x.png', 'libs/a/src/navigation/tabs/house@2x.png']]);
  assert.equal(exitCode, 0);
  assert.deepEqual(readdirSync(join(root, 'libs/a/src/navigation/tabs')).sort(), ['house.png', 'house@2x.png', 'house@3x.png']);
  assert.deepEqual(readdirSync(join(root, 'libs/a/src/navigation/icons')), ['homeFilled.png']);
  assert.equal(read(root, 'libs/a/src/navigation/Navigation.ios.tsx'), `export const icon = require('./tabs/house.png');\n`);
});

test('require(), asset and side-effect imports, mocks and import types follow a moved folder', { skip }, (t) => {
  const root = repo(t, {
    'libs/a/src/images/ticket.png': 'png',
    'libs/a/src/styles/base.css': '',
    'libs/a/src/images/picture/picture.css': '',
    'libs/a/src/images/picture/sources.ts': `export const sources = { ticket: require('../ticket.png') };\n`,
    'libs/a/src/images/picture/sources.web.ts': `import ticket from '../ticket.png';\n\nexport const sources = { ticket };\n`,
    'libs/a/src/images/picture/Picture.tsx': `import './picture.css';
import '../../styles/base.css';

import { sources } from './sources';

export const Picture = sources;
`,
    'libs/a/src/images/picture/legacy.js': `module.exports = require('../../styles/base.css');\n`,
    'libs/a/src/screens/Screen.test.tsx': `jest.mock('../images/picture/Picture');
vi.mock('../images/picture/sources');

type P = import('../images/picture/Picture').Picture;
`,
  });
  const { exitCode } = run(root, [['libs/a/src/images/picture', 'libs/a/src/media/raster/picture']]);
  assert.equal(exitCode, 0);
  const moved = 'libs/a/src/media/raster/picture';
  assert.equal(read(root, `${moved}/sources.ts`), `export const sources = { ticket: require('../../../images/ticket.png') };\n`);
  assert.equal(read(root, `${moved}/sources.web.ts`), `import ticket from '../../../images/ticket.png';\n\nexport const sources = { ticket };\n`);
  assert.equal(
    read(root, `${moved}/Picture.tsx`),
    `import './picture.css';
import '../../../styles/base.css';

import { sources } from './sources';

export const Picture = sources;
`,
  );
  assert.equal(read(root, `${moved}/legacy.js`), `module.exports = require('../../../styles/base.css');\n`);
  assert.equal(
    read(root, 'libs/a/src/screens/Screen.test.tsx'),
    `jest.mock('../media/raster/picture/Picture');
vi.mock('../media/raster/picture/sources');

type P = import('../media/raster/picture/Picture').Picture;
`,
  );
});

test('entry export lines follow a move inside the package; alias imports stay untouched', { skip }, (t) => {
  const index = (path) => `export * from './${path}/Card';
export { type ICardRow, CardRow } from './${path}/CardRow'; // row only
`;
  const card = `import { useNow } from '@demo/b';\n\nexport const Card = useNow;\n`;
  const screen = `import { Card } from '@demo/a';\n\nexport const Screen = Card;\n`;
  const root = repo(t, {
    'libs/a/src/index.ts': index('cards'),
    'libs/a/src/cards/Card.tsx': card,
    'libs/a/src/cards/CardRow.tsx': `export interface ICardRow {}\nexport const CardRow = 1;\n`,
    'libs/b/src/index.ts': `export const useNow = 1;\n`,
    'apps/app/src/Screen.tsx': screen,
  });
  const { exitCode } = run(root, [['libs/a/src/cards', 'libs/a/src/blocks/cards']]);
  assert.equal(exitCode, 0);
  assert.equal(read(root, 'libs/a/src/index.ts'), index('blocks/cards'));
  assert.equal(read(root, 'libs/a/src/blocks/cards/Card.tsx'), card);
  assert.equal(read(root, 'apps/app/src/Screen.tsx'), screen);
});

test('a move between packages rewrites aliases, entry lines and relative links, listing what it cannot', { skip }, (t) => {
  const root = repo(t, {
    'libs/a/src/index.ts': `export * from './blocks/Card';\n`,
    'libs/a/src/blocks/Card.tsx': `export interface ICardProps {}\nexport const Card = 1;\n`,
    'libs/b/src/index.ts': `export * from './steps/Steps';\nexport * from './steps/Empty';\n`,
    'libs/b/src/hooks/useSteps.ts': `export const useSteps = 1;\n`,
    'libs/b/src/steps/Empty.tsx': `import { Card, type ICardProps } from '@demo/a';

import { useSteps } from '../hooks/useSteps';

export type EmptyKind = 'none';
export const Empty = (props: ICardProps) => [Card, useSteps, props];
`,
    'libs/b/src/steps/Hint.tsx': `export const Hint = 1;\n`,
    'libs/b/src/steps/Steps.tsx': `import { Card } from '@demo/a';

import { Empty } from './Empty';
import { Hint } from './Hint';

export const Steps = [Card, Empty, Hint];
`,
    'libs/b/src/steps/List.tsx': `import { Empty } from './Empty';\n\nexport const List = Empty;\n`,
    'libs/b/src/steps/Panel.tsx': `import { Empty } from './Empty';\nimport { Hint } from './Hint';\n\nexport const Panel = [Empty, Hint];\n`,
    'apps/app/src/Screen.tsx': `import { Empty, type EmptyKind, Steps } from '@demo/b';\n\nexport const Screen = [Empty, Steps] as EmptyKind[];\n`,
    'apps/app/src/Other.tsx': `import { Card } from '@demo/a';\nimport { Empty } from '@demo/b';\n\nexport const Other = [Card, Empty];\n`,
  });
  const { exitCode, lines } = run(root, [
    ['libs/b/src/steps/Empty', 'libs/a/src/blocks/Empty'],
    ['libs/b/src/steps/Hint.tsx', 'libs/a/src/blocks/Hint.tsx'],
  ]);

  assert.equal(exitCode, 1);
  // The old entry loses the moved line; the new one gets it and the line a left-behind importer needs.
  assert.equal(read(root, 'libs/b/src/index.ts'), `export * from './steps/Steps';\n`);
  assert.equal(
    read(root, 'libs/a/src/index.ts'),
    `export * from './blocks/Card';
export * from './blocks/Empty';
export * from './blocks/Hint';
`,
  );
  // The own alias turns relative; an unexported internal of the old package is a to-do.
  assert.equal(
    read(root, 'libs/a/src/blocks/Empty.tsx'),
    `import { Card, type ICardProps } from './Card';

import { useSteps } from '../../../b/src/hooks/useSteps';

export type EmptyKind = 'none';
export const Empty = (props: ICardProps) => [Card, useSteps, props];
`,
  );
  assert.deepEqual(
    lines.filter((line) => line.startsWith('todo: ')),
    [`todo: libs/a/src/blocks/Empty.tsx: '../../../b/src/hooks/useSteps' reaches into libs/b, which @demo/b does not export`],
  );
  // Importers left behind take the new alias, merged into an existing import of it.
  assert.equal(
    read(root, 'libs/b/src/steps/Steps.tsx'),
    `import { Card, Empty, Hint } from '@demo/a';


export const Steps = [Card, Empty, Hint];
`,
  );
  assert.equal(read(root, 'libs/b/src/steps/List.tsx'), `import { Empty } from '@demo/a';\n\nexport const List = Empty;\n`);
  // Without one, the first new declaration takes the later ones in.
  assert.equal(read(root, 'libs/b/src/steps/Panel.tsx'), `import { Empty, Hint } from '@demo/a';\n\nexport const Panel = [Empty, Hint];\n`);
  // Imports of the old alias split off the moved names, or merge them into the new alias.
  assert.equal(
    read(root, 'apps/app/src/Screen.tsx'),
    `import { Steps } from '@demo/b';
import { Empty, type EmptyKind } from '@demo/a';

export const Screen = [Empty, Steps] as EmptyKind[];
`,
  );
  assert.equal(read(root, 'apps/app/src/Other.tsx'), `import { Card, Empty } from '@demo/a';\n\nexport const Other = [Card, Empty];\n`);
});

// A single-package app with an @/* alias in a commented tsconfig, as Next and Vite templates write it.
const APP = {
  'package.json': JSON.stringify({ name: 'shop', dependencies: { next: '15.0.0' } }),
  'tsconfig.json': `{
  // Next writes comments and trailing commas
  "compilerOptions": {
    "paths": { "@/*": ["./src/*"], },
  },
}
`,
  'src/components/Button.tsx': `import { cn } from '@/lib/cn';\n\nexport const Button = cn;\n`,
  'src/lib/cn.ts': `export const cn = 1;\n`,
  'src/features/cart/Cart.tsx': `import { Button } from '@/components/Button';\nimport { cn } from '../../lib/cn';\n\nexport const Cart = [Button, cn];\n`,
  'src/app/page.tsx': `import { Cart } from '@/features/cart/Cart';\n\nexport default Cart;\n`,
};

test('alias imports follow a move through the same alias, and turn relative out of its reach', { skip }, (t) => {
  const root = repo(t, APP, {});
  assert.equal(run(root, [['src/components', 'src/ui/controls']]).exitCode, 0);
  assert.equal(read(root, 'src/features/cart/Cart.tsx'), `import { Button } from '@/ui/controls/Button';\nimport { cn } from '../../lib/cn';\n\nexport const Cart = [Button, cn];\n`);
  assert.equal(read(root, 'src/ui/controls/Button.tsx'), `import { cn } from '@/lib/cn';\n\nexport const Button = cn;\n`);
  run(root, [['src/lib/cn.ts', 'shared/cn.ts']]);
  assert.equal(read(root, 'src/ui/controls/Button.tsx'), `import { cn } from '../../../shared/cn';\n\nexport const Button = cn;\n`);
});

test('a route folder moves only with --routes', { skip }, (t) => {
  const root = repo(t, APP, {});
  const refused = run(root, [['src/app/page.tsx', 'src/app/shop/page.tsx']]);
  assert.equal(refused.exitCode, 2);
  assert.match(refused.lines[0], /touches the route folder src\/app: its file paths are URLs; pass --routes/);
  assert.equal(run(root, [['src/app/page.tsx', 'src/app/shop/page.tsx']], { routes: true }).exitCode, 0);
  assert.equal(read(root, 'src/app/shop/page.tsx'), `import { Cart } from '@/features/cart/Cart';\n\nexport default Cart;\n`);
});

test('NodeNext .js specifiers keep their extension; component files keep their markup', { skip }, (t) => {
  const root = repo(t, {
    'package.json': JSON.stringify({ name: 'lib', type: 'module' }),
    'src/util/slug.ts': `export const slug = 1;\n`,
    'src/main.ts': `import { slug } from './util/slug.js';\n\nexport { slug };\n`,
    'src/Card.vue': `<template>\n  <Slug :value="'./util/slug.js'" />\n</template>\n\n<script setup lang="ts">\nimport { slug } from './util/slug.js';\n</script>\n`,
  }, {});
  assert.equal(run(root, [['src/util/slug.ts', 'src/text/slug.ts']]).exitCode, 0);
  assert.equal(read(root, 'src/main.ts'), `import { slug } from './text/slug.js';\n\nexport { slug };\n`);
  assert.equal(
    read(root, 'src/Card.vue'),
    `<template>\n  <Slug :value="'./util/slug.js'" />\n</template>\n\n<script setup lang="ts">\nimport { slug } from './text/slug.js';\n</script>\n`,
  );
});

test('a workspace deep import follows its target; a package entry does not move', { skip }, (t) => {
  const root = repo(t, {
    'package.json': JSON.stringify({ name: 'mono', private: true, workspaces: ['packages/*'] }),
    'packages/ui/package.json': JSON.stringify({ name: '@acme/ui', main: 'src/index.ts' }),
    'packages/ui/src/index.ts': `export * from './Button';\n`,
    'packages/ui/src/Button.tsx': `export const Button = 1;\n`,
    'packages/web/package.json': JSON.stringify({ name: '@acme/web' }),
    'packages/web/src/Page.tsx': `import { Button } from '@acme/ui/src/Button';\n\nexport const Page = Button;\n`,
  }, {});
  assert.equal(run(root, [['packages/ui/src/Button.tsx', 'packages/ui/src/controls/Button.tsx']]).exitCode, 0);
  assert.equal(read(root, 'packages/web/src/Page.tsx'), `import { Button } from '@acme/ui/src/controls/Button';\n\nexport const Page = Button;\n`);
  assert.equal(read(root, 'packages/ui/src/index.ts'), `export * from './controls/Button';\n`);
  const refused = run(root, [['packages/ui/src/index.ts', 'packages/ui/src/main.ts']]);
  assert.equal(refused.exitCode, 2);
  assert.match(refused.lines[0], /packages\/ui\/src\/index\.ts is the entry of @acme\/ui/);
});

const REFUSAL_REPO = {
  'libs/a/src/index.ts': `export * from './cards/Card';\n`,
  'libs/a/src/cards/Card.tsx': `export const Card = 1;\n`,
  'libs/a/src/cards/Card.ios.tsx': `export const Card = 2;\n`,
  'libs/a/src/cards/CardRow.tsx': `export const CardRow = 1;\n`,
  'apps/app/src/screens/Home.tsx': `export const Home = 1;\n`,
  'node_modules/x/index.js': `module.exports = 1;\n`,
};

const REFUSALS = [
  ['a missing source', [['libs/a/src/nope', 'libs/a/src/yes']], /no such file/],
  ['an existing target', [['libs/a/src/cards/Card', 'libs/a/src/cards/CardRow']], /already exists/],
  ['a path in node_modules', [['node_modules/x/index.js', 'libs/a/src/x.js']], /inside node_modules/],
  ['a path outside the repository', [['libs/a/src/cards', '../cards']], /outside the repository/],
  ['a package root', [['libs/a', 'libs/c']], /package root/],
  ['a source root', [['libs/a/src', 'libs/b/src/a']], /source root/],
  ['a package entry', [['libs/a/src/index.ts', 'libs/a/src/main.ts']], /is the entry of @demo\/a/],
  ['a target inside its source', [['libs/a/src/cards', 'libs/a/src/cards/inner']], /is inside/],
  [
    'overlapping sources',
    [
      ['libs/a/src/cards', 'libs/a/src/x'],
      ['libs/a/src/cards/CardRow.tsx', 'libs/a/src/y/CardRow.tsx'],
    ],
    /overlap/,
  ],
  [
    'colliding targets',
    [
      ['libs/a/src/cards/CardRow.tsx', 'libs/a/src/z/Z.tsx'],
      ['apps/app/src/screens/Home.tsx', 'libs/a/src/z/Z.tsx'],
    ],
    /collide/,
  ],
  ['a changed platform suffix', [['libs/a/src/cards/Card.ios.tsx', 'libs/a/src/cards/Tile.tsx']], /suffix/],
  [
    'a folder as the new path of a file',
    [['libs/a/src/cards/CardRow.tsx', 'apps/app/src/screens']],
    /apps\/app\/src\/screens is a folder; give the full new path, e\.g\. apps\/app\/src\/screens\/CardRow\.tsx/,
  ],
  ['a new file path ending with a slash', [['libs/a/src/cards/CardRow.tsx', 'libs/a/src/rows/']], /libs\/a\/src\/rows is a folder; give the full new path/],
  [
    'targets that differ only in case',
    [
      ['libs/a/src/cards/CardRow.tsx', 'libs/a/src/z/Z.tsx'],
      ['apps/app/src/screens/Home.tsx', 'libs/a/src/z/z.tsx'],
    ],
    /collide/,
  ],
  ['a file on the new path', [['apps/app/src/screens/Home.tsx', 'libs/a/src/cards/CardRow.tsx/Home.tsx']], /libs\/a\/src\/cards\/CardRow\.tsx is a file/],
  [
    'a case-only rename onto a name the folder already holds',
    [['libs/a/src/rows/Row.tsx', 'libs/a/src/rows/row.tsx']],
    /already exists/,
    { 'libs/a/src/rows/Row.tsx': `export const Row = 1;\n`, 'libs/a/src/rows/row.tsx': `export const row = 1;\n` },
  ],
];

// Whether the temporary folder tells Foo from foo; APFS does not by default.
const isCaseSensitive = () => {
  const dir = mkdtempSync(join(tmpdir(), 'move-case-'));
  writeFileSync(join(dir, 'a'), '');
  const sensitive = !existsSync(join(dir, 'A'));
  rmSync(dir, { recursive: true, force: true });
  return sensitive;
};

const caseSensitive = isCaseSensitive();

// Extra files are two names that differ only in case: they need a case-sensitive disk.
for (const [name, moves, message, files] of REFUSALS) {
  test(`refuses ${name} with exit 2 and writes nothing`, { skip: skip || (!!files && !caseSensitive && 'needs a case-sensitive disk') }, (t) => {
    const root = repo(t, { ...REFUSAL_REPO, ...files });
    const before = snapshot(root);
    const { exitCode, lines } = run(root, moves);
    assert.equal(exitCode, 2);
    assert.match(lines.join('\n'), /^move: refused: /);
    assert.match(lines.join('\n'), message);
    assert.deepEqual(snapshot(root), before);
  });
}

test('a dry run prints every edit and writes nothing', { skip }, (t) => {
  const root = repo(t, CARDS);
  const before = snapshot(root);
  const { exitCode, lines } = run(root, [['libs/a/src/cards', 'libs/a/src/blocks/card']], { dryRun: true });
  assert.equal(exitCode, 0);
  assert.deepEqual(snapshot(root), before);
  assert.deepEqual(lines, [
    'move libs/a/src/cards → libs/a/src/blocks/card (2 files)',
    `libs/a/src/cards/Card.tsx:1 '../lib/helper' → '../../lib/helper'`,
    `libs/a/src/screens/Screen.tsx:1 '../cards/Card' → '../blocks/card/Card'`,
    'dry run: nothing written',
  ]);
});

test('the project formats the edited files only when it configures a formatter', { skip: skip || (process.platform === 'win32' && 'shell script formatter') }, (t) => {
  const root = repo(t, CARDS);
  const bin = join(root, 'node_modules/.bin/prettier');
  mkdirSync(dirname(bin), { recursive: true });
  writeFileSync(bin, '#!/bin/sh\nexit 2\n');
  chmodSync(bin, 0o755);
  // Installed but not configured: not the project's style, so it does not run.
  const quiet = run(root, [['libs/a/src/cards', 'libs/a/src/blocks/card']], { format: true });
  assert.equal(quiet.exitCode, 0);
  assert.ok(!quiet.lines.some((line) => /prettier/.test(line)));
  writeFileSync(join(root, '.prettierrc'), '{}');
  const failed = run(root, [['libs/a/src/blocks/card', 'libs/a/src/cards']], { format: true });
  assert.equal(failed.exitCode, 1);
  assert.deepEqual(failed.lines.filter((line) => line.startsWith('todo: ')), ['todo: prettier --write failed on the edited files; run it by hand']);
});

test('references to a moved path that are not imports are listed, not rewritten', { skip }, (t) => {
  const jestConfig = `module.exports = { setupFiles: ['<rootDir>/src/cards/Card.tsx'] };\n`;
  const toolConfig = `export const EXEMPT = [
  'libs/a/src/cardsOld/**',
  'libs/a/src/cards/**',
];
`;
  const root = repo(t, {
    ...CARDS,
    'libs/a/jest.config.js': jestConfig,
    'tools/config.mjs': toolConfig,
    'docs/map.md': '- `libs/a/src/cards`: the cards\n- `other/libs/a/src/cards` is not it\n',
  });
  execFileSync('git', ['init', '-q'], { cwd: root });
  const { lines } = run(root, [['libs/a/src/cards', 'libs/a/src/blocks/card']], { dryRun: true });
  assert.deepEqual(
    lines.filter((line) => line.startsWith('mention ')),
    [
      'mention (not rewritten): docs/map.md:1 libs/a/src/cards',
      'mention (not rewritten): libs/a/jest.config.js:1 libs/a/src/cards',
      'mention (not rewritten): tools/config.mjs:3 libs/a/src/cards',
    ],
  );
  assert.equal(read(root, 'tools/config.mjs'), toolConfig);
});

test('folders a move empties are removed up to the source root', { skip }, (t) => {
  const root = repo(t, {
    'libs/a/src/trips/card/tile/Tile.tsx': `export const Tile = 1;\n`,
    'libs/a/src/trips/card/tile/Tile.ios.tsx': `export const Tile = 2;\n`,
    'libs/a/src/trips/card/.DS_Store': '',
    'libs/a/src/other/Other.tsx': `export const Other = 1;\n`,
  });
  assert.equal(run(root, [['libs/a/src/trips/card/tile/Tile', 'libs/a/src/blocks/tile/Tile']]).exitCode, 0);
  assert.ok(exists(root, 'libs/a/src/blocks/tile/Tile.ios.tsx'));
  assert.ok(!exists(root, 'libs/a/src/trips'));
  assert.deepEqual(readdirSync(join(root, 'libs/a/src')).sort(), ['blocks', 'other']);
});

test('a case-only folder rename goes through a temporary name', { skip }, (t) => {
  const root = repo(t, {
    'libs/a/src/Cards/Card.tsx': `export const Card = 1;\n`,
    'libs/a/src/screens/Screen.tsx': `import { Card } from '../Cards/Card';\n`,
  });
  assert.equal(run(root, [['libs/a/src/Cards', 'libs/a/src/cards']]).exitCode, 0);
  assert.deepEqual(readdirSync(join(root, 'libs/a/src')).sort(), ['cards', 'screens']);
  assert.equal(read(root, 'libs/a/src/screens/Screen.tsx'), `import { Card } from '../cards/Card';\n`);
});

test('the command line takes paths from the working directory and the git work tree as the project', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'move-cli-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'src/ui'), { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: root });
  const options = parseOptions(['--dry-run', 'Button.tsx', '../controls/Button.tsx', 'x/', 'y/'], join(root, 'src/ui'));
  assert.equal(options.dryRun, true);
  assert.deepEqual(options.moves, [
    { from: 'src/ui/Button.tsx', to: 'src/controls/Button.tsx' },
    { from: 'src/ui/x/', to: 'src/ui/y/' },
  ]);
  assert.throws(() => parseOptions(['only-one'], root), /pairs/);
});
