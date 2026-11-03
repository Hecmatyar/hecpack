// The import graph of a project's own code, from the project's TypeScript parsing each file once: which
// file imports which (relative paths, aliases, workspace package names), which packages from outside,
// and where each file sits (package, unit, layer and role names). Tests, stories and declaration files
// are left out: the architecture is what the shipped code depends on.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CODE_FILE, importsOf, resolveFile, resolveImport } from '../code/source.mjs';

export const TEST_FILE = /(?:\.(?:test|spec|integration|stories|story|e2e)\.[cm]?[jt]sx?$|(?:^|\/)(?:__tests__|__mocks__|[\w.-]*-e2e|e2e|test|tests)\/|\.d\.ts$)/;
const RELATIVE = /^\.\.?(\/|$)/;
const BUILTIN = /^(?:node:|bun:)/;

// The npm package a bare specifier names: react-native/Libraries/x → react-native, @a/b/c → @a/b.
const packageName = (specifier) => {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
};

// Where a path sits: its package, the unit (the first folder under the package's src, or under the
// package when it has none), and the rest below the unit.
export const placeOf = (layout, path) => {
  const project = layout.projectOf(path);
  const base = project === '.' ? '' : `${project}/`;
  let rest = path.slice(base.length);
  let src = base;
  if (rest.startsWith('src/')) {
    src = `${base}src/`;
    rest = rest.slice(4);
  }
  const slash = rest.indexOf('/');
  return { project, unit: slash < 0 ? src.replace(/\/$/, '') || '.' : `${src}${rest.slice(0, slash)}`, inner: slash < 0 ? '' : rest.slice(slash + 1) };
};

// → { nodes: Map path → { path, project, unit, lines, ui, imports: [{ target, line, typeOnly }],
// external: Set, dependents: Set }, files }.
export const buildGraph = ({ root, layout, tree, source }) => {
  const files = tree.files.filter((path) => CODE_FILE.test(path) && !TEST_FILE.test(path));
  const nodes = new Map();
  for (const path of files) {
    const text = readFileSync(join(root, path), 'utf8');
    nodes.set(path, {
      path,
      ...placeOf(layout, path),
      lines: text.split('\n').length - (text.endsWith('\n') ? 1 : 0),
      ui: /\.(?:tsx|jsx|vue|svelte)$/.test(path),
      imports: [],
      external: new Set(),
      dependents: new Set(),
    });
  }
  const exists = (path) => !!resolveFile(tree.fileSet, path, layout.platforms) || tree.dirs.has(path);
  for (const node of nodes.values()) {
    const seen = new Set();
    for (const entry of importsOf(source(node.path))) {
      const { specifier } = entry;
      let target = null;
      if (RELATIVE.test(specifier)) {
        target = resolveImport(tree.fileSet, node.path, specifier, layout.platforms);
      } else if (!BUILTIN.test(specifier)) {
        const alias = layout.resolveAlias(node.path, specifier, exists);
        if (alias) target = resolveFile(tree.fileSet, alias.target, layout.platforms);
        else node.external.add(packageName(specifier));
      }
      if (!target || !nodes.has(target) || target === node.path) continue;
      const key = `${target}:${entry.typeOnly}`;
      if (seen.has(key)) continue;
      seen.add(key);
      node.imports.push({ target, line: entry.line, typeOnly: entry.typeOnly });
      nodes.get(target).dependents.add(node.path);
    }
  }
  return { nodes, files };
};
