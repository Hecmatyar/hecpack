// Moves between packages. A relative link that now crosses packages goes through the target package's
// alias: its entry when the entry exports the module, else a wildcard alias the project declares. A
// moved module's export line leaves the old entry for the new one; imports of the old alias that take
// moved names follow them; imports of the new package's own alias inside the moved files turn relative.
// What cannot be rewritten safely keeps a correct relative path and becomes a to-do.

import { importedName, namedElements, regroup } from './declarations.mjs';
import { exportsModule, indexAdditions, moveIndexLine } from './indexLines.mjs';
import { readLibExports } from './libExports.mjs';
import { relativeSpecifier, specifierEdit } from './plan.mjs';
import { importsOf } from '../code/source.mjs';
import { ts } from '../code/typescript.mjs';

// → { edits, todos }. edits: the planned specifier edits, so that a declaration they retarget still
// takes in elements for its new module. files: the code files to read. Index lines: indexLines.mjs.
export const resolveCrossings = ({ tree, source, layout, moves, mapPath, edits, crossings, files }) => {
  if (!crossings.length && moves.every(({ from, to }) => layout.projectOf(from) === layout.projectOf(to))) {
    return { edits: [], todos: [] };
  }
  const context = {
    tree,
    source,
    layout,
    mapPath,
    libExports: readLibExports(tree, source, layout),
    edits: [],
    todos: [],
    // New entry file → export lines to add.
    added: new Map(),
    // Old alias → moved name → { target, original }.
    movedNames: new Map(),
    // Path → declarations whose elements change module.
    changes: new Map(),
  };
  const isIndexLine = ({ path, entry }) =>
    path === layout.libs.get(layout.projectOf(path))?.index && ts.isExportDeclaration(entry.node);

  for (const link of crossings.filter(isIndexLine)) moveIndexLine(context, link);
  for (const link of crossings.filter((link) => !isIndexLine(link))) crossLink(context, link);
  for (const path of files) followAliases(context, path);

  const specifiers = new Map(
    [...edits, ...context.edits].filter(({ node }) => node).map(({ node, text }) => [node, text]),
  );
  return {
    edits: [
      ...context.edits,
      ...[...context.changes].flatMap(([path, changes]) => regroup(path, source(path), changes, specifiers)),
      ...indexAdditions(context),
    ],
    todos: context.todos,
  };
};

// A link that now crosses packages. A named declaration takes the target package's alias when its entry
// exports the module; then a wildcard alias the project declares; anything else keeps a correct relative
// path and becomes a to-do (exporting an internal module would be accidental public API).
const crossLink = (context, link) => {
  const { entry } = link;
  const { layout } = context;
  const elements = namedElements(entry.node);
  const project = layout.projectOf(link.newTarget);
  const lib = layout.libs.get(project);
  if (elements && lib && exportsModule(context, lib, link, elements.map(importedName))) {
    const texts = elements.map((element) => element.getText());
    addChange(context, link.path, entry.node, new Map([[lib.alias, texts]]));
    return;
  }
  const viaAlias = layout.expressAlias(link.newPath, link.newTarget);
  if (viaAlias) {
    context.edits.push(specifierEdit(link.path, entry, viaAlias));
    return;
  }
  const specifier = relativeSpecifier(link.newPath, link.newTarget, entry.specifier);
  context.edits.push(specifierEdit(link.path, entry, specifier));
  const reason = !elements
    ? 'not a named import or export'
    : !lib
      ? 'which has no alias for its entry'
      : `which ${lib.alias} does not export`;
  context.todos.push(`${link.newPath}: '${specifier}' reaches into ${project}, ${reason}`);
};

// Imports of an old alias whose names moved follow them: to the new package's alias, or a relative path
// inside the importer's package. A file that moved into a package imports that package's own alias by
// path, found through its entry.
const followAliases = (context, path) => {
  const { layout } = context;
  const newPath = context.mapPath(path) ?? path;
  const project = layout.projectOf(newPath);
  const ownAlias = project !== layout.projectOf(path) ? layout.libs.get(project)?.alias : undefined;
  for (const entry of importsOf(context.source(path))) {
    const own = entry.specifier === ownAlias;
    const moved = context.movedNames.get(entry.specifier);
    if (!own && !moved) continue;
    const elements = namedElements(entry.node);
    if (!elements) {
      context.todos.push(`${newPath}: '${entry.specifier}' is not a named import; check it for moved names`);
      continue;
    }

    // The declaration's own module first, so the elements that stay keep their place.
    const groups = new Map([[entry.specifier, []]]);
    for (const element of elements) {
      const name = importedName(element);
      const place = own ? ownExport(context, project, name) : moved.get(name);
      const retargeted = place && retarget(context, newPath, element, place);
      if (!retargeted && (own || place)) {
        context.todos.push(`${newPath}: ${name} from '${entry.specifier}' has no new place to import it from`);
      }
      const [specifier, text] = retargeted || [entry.specifier, element.getText()];
      groups.set(specifier, [...(groups.get(specifier) ?? []), text]);
    }
    if (groups.size > 1) addChange(context, path, entry.node, groups);
  }
};

// [specifier, element text] for a name now at target: relative inside the importer's package, else the
// target package's alias; null when neither works.
const retarget = (context, importer, element, { target, original }) => {
  const { layout } = context;
  const project = layout.projectOf(target);
  if (project === layout.projectOf(importer)) {
    const name = element.name.text;
    const type = element.isTypeOnly ? 'type ' : '';
    const text = original === name ? `${type}${name}` : `${type}${original} as ${name}`;
    return [relativeSpecifier(importer, target), text];
  }
  const alias = layout.libs.get(project)?.alias;
  return alias ? [alias, element.getText()] : null;
};

// Where a package's own entry takes a name from, after the move.
const ownExport = (context, project, name) => {
  const line = context.libExports(project).find(({ names }) => names.has(name));
  return line && { target: context.mapPath(line.target) ?? line.target, original: line.names.get(name) };
};

const addChange = (context, path, node, groups) =>
  context.changes.set(path, [...(context.changes.get(path) ?? []), { node, groups }]);
