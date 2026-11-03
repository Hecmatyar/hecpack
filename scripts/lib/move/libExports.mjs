// What each package's entry file exports before the move, for alias rewrites.

import { SCRIPT_FILE } from '../layout.mjs';
import { importedName } from './declarations.mjs';
import { RELATIVE, pointsAt } from './plan.mjs';
import { exportedNames, importsOf, resolveImport } from './source.mjs';
import { ts } from './typescript.mjs';

// Per package, the export lines of its entry file as they are before the move: the module each points
// at (resolved file and path as spelled) and its names → their names in the module.
export const readLibExports = (tree, source, layout) => {
  const cache = new Map();
  return (project) => {
    const index = layout.libs.get(project)?.index;
    if (!index || !tree.fileSet.has(index)) return [];
    if (!cache.has(project)) {
      const lines = importsOf(source(index))
        .filter(({ node, specifier }) => ts.isExportDeclaration(node) && RELATIVE.test(specifier))
        .map(({ node, specifier }) => {
          const file = resolveImport(tree.fileSet, index, specifier, layout.platforms);
          return { node, file, target: pointsAt(index, specifier), names: lineNames(tree, source, layout, node, file) };
        });
      cache.set(project, lines);
    }
    return cache.get(project);
  };
};

// export * → every name of the module but default; export { A as B } → B → A.
const lineNames = (tree, source, layout, node, file) => {
  const clause = node.exportClause;
  if (!clause) {
    return new Map(
      moduleNames(tree, source, layout, file)
        .filter((name) => name !== 'default')
        .map((name) => [name, name]),
    );
  }
  // export * as ns: its names are not followed.
  if (!ts.isNamedExports(clause)) return new Map();
  return new Map(clause.elements.map((element) => [element.name.text, importedName(element)]));
};

// Names a module exports, through its relative `export *` lines.
const moduleNames = (tree, source, layout, file, seen = new Set()) => {
  if (!file || !SCRIPT_FILE.test(file) || !tree.fileSet.has(file) || seen.has(file)) return [];
  seen.add(file);
  const stars = importsOf(source(file)).filter(({ node }) => ts.isExportDeclaration(node) && !node.exportClause);
  return [
    ...exportedNames(source(file)).keys(),
    ...stars.flatMap(({ specifier }) =>
      moduleNames(tree, source, layout, resolveImport(tree.fileSet, file, specifier, layout.platforms), seen),
    ),
  ];
};
