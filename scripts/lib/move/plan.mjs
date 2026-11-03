// The specifier edits a set of moves needs. A relative specifier is read from its importer's old folder;
// when it no longer points at the same path from the importer's new folder, it is rewritten. An alias
// specifier (tsconfig paths, a workspace deep import) is rewritten when its target moved or the importer
// left the alias's reach: through an alias again when one reaches, else relatively. A link whose ends now
// land in different packages is a crossing, left to crossProject.mjs.

import { posix } from 'node:path';
import { importsOf } from './source.mjs';

// ., .., ./x, ../x
export const RELATIVE = /^\.\.?(\/|$)/;

const EXTENSIONS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '/index.ts', '/index.tsx', '/index.js'];

// Whether a path as an import spells it names something in the tree.
export const inTree = (tree, path) => tree.dirs.has(path) || EXTENSIONS.some((extension) => tree.fileSet.has(path + extension));

// files: the code files to read. → { edits, crossings }; an edit is { path, start, end, text, line,
// before, after, node? }, a crossing { path, newPath, entry, target, newTarget, alias? }.
export const planEdits = ({ tree, source, mapPath, layout, files }) => {
  const edits = [];
  const crossings = [];
  const exists = (path) => inTree(tree, path);
  for (const path of files) {
    const newPath = mapPath(path) ?? path;
    for (const entry of importsOf(source(path))) {
      if (RELATIVE.test(entry.specifier)) {
        const target = pointsAt(path, entry.specifier);
        const newTarget = mapPath(target) ?? target;
        // Unchanged links, and links between files that moved together.
        if (pointsAt(newPath, entry.specifier) === newTarget) continue;
        if (layout.projectOf(newTarget) !== layout.projectOf(newPath)) {
          crossings.push({ path, newPath, entry, target, newTarget });
        } else {
          edits.push(specifierEdit(path, entry, relativeSpecifier(newPath, newTarget, entry.specifier)));
        }
        continue;
      }
      const resolved = layout.resolveAlias(path, entry.specifier, exists);
      // Exact aliases name entry files, which never move; crossProject.mjs follows the names they export.
      if (!resolved || resolved.exact) continue;
      const newTarget = mapPath(resolved.target) ?? resolved.target;
      const again = layout.resolveAlias(newPath, entry.specifier, exists);
      if (again && !again.exact && again.target === newTarget) continue;
      const viaAlias = layout.expressAlias(newPath, newTarget, resolved.alias);
      if (viaAlias) {
        edits.push(specifierEdit(path, entry, viaAlias));
      } else if (layout.projectOf(newTarget) !== layout.projectOf(newPath)) {
        crossings.push({ path, newPath, entry, target: resolved.target, newTarget });
      } else {
        edits.push(specifierEdit(path, entry, relativeSpecifier(newPath, newTarget)));
      }
    }
  }
  return { edits, crossings };
};

// The specifier from importer to target, in the style of the old one: ./ prefix, trailing slash.
export const relativeSpecifier = (importer, target, old = '') => {
  const path = posix.relative(posix.dirname(importer), target) || '.';
  const specifier = RELATIVE.test(path) ? path : `./${path}`;
  return old.endsWith('/') ? `${specifier}/` : specifier;
};

// Replaces the text between the quotes of an importsOf entry.
export const specifierEdit = (path, entry, specifier) => ({
  path,
  start: entry.start + 1,
  end: entry.end - 1,
  text: specifier,
  line: entry.line,
  before: `'${entry.specifier}'`,
  after: `'${specifier}'`,
  node: entry.node,
});

// Repo path of a relative specifier, without a trailing slash.
export const pointsAt = (importer, specifier) => posix.join(posix.dirname(importer), specifier).replace(/\/$/, '');
