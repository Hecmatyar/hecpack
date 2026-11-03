// Entry file lines in a move between packages: a moved module's export line leaves the old package's
// entry for the new one's, a moved module that importers left behind now take through the new package's
// alias gets an `export *` line there, and the new lines go to the end of the file.
// context: see resolveCrossings in crossProject.mjs.

import { removal } from './declarations.mjs';
import { relativeSpecifier } from './plan.mjs';
import { resolveImport } from '../code/source.mjs';

// The old package's export line of a moved module leaves its entry; the new package's entry gets it
// with the new path, and its names are kept for the importers of the old alias.
export const moveIndexLine = (context, link) => {
  const { entry } = link;
  const { layout } = context;
  const file = context.source(link.path);
  context.edits.push(removal(link.path, file, entry.node));

  const oldAlias = layout.libs.get(layout.projectOf(link.path)).alias;
  const line = context.libExports(layout.projectOf(link.path)).find(({ node }) => node === entry.node);
  const moved = context.movedNames.get(oldAlias) ?? new Map();
  for (const [name, original] of line.names) moved.set(name, { target: link.newTarget, original });
  context.movedNames.set(oldAlias, moved);

  const project = layout.projectOf(link.newTarget);
  const lib = layout.libs.get(project);
  if (!lib) {
    context.todos.push(`${link.newTarget}: ${oldAlias} exported it, and ${project} has no entry file with an alias`);
    return;
  }
  const specifier = relativeSpecifier(lib.index, link.newTarget, entry.specifier);
  addIndexLine(context, lib, {
    file: line.file,
    names: entry.node.exportClause ? line.names : null,
    text: withSpecifier(file, entry, specifier),
  });
};

// Whether the package's entry exports the linked module with these names. A moved module gets an
// `export *` line there unless its moved line covers it; an unmoved one needs a line of its own.
export const exportsModule = (context, lib, link, names) => {
  const { layout } = context;
  const file = resolveImport(context.tree.fileSet, link.path, link.entry.specifier, layout.platforms);
  const covers = (line) => !line.names || names.every((name) => line.names.get(name) === name);
  if (link.newTarget === link.target) {
    return context.libExports(layout.projectOf(link.target)).some((line) => line.file === file && covers(line));
  }
  const line = context.added.get(lib.index)?.find((item) => item.file === file);
  if (line) return covers(line);
  const specifier = relativeSpecifier(lib.index, link.newTarget, link.entry.specifier);
  addIndexLine(context, lib, { file, names: null, text: `export * from '${specifier}';` });
  return true;
};

// New export lines go to the end of each entry file; the project's linter sorts them in.
export const indexAdditions = (context) =>
  [...context.added].flatMap(([index, lines]) => {
    if (!context.tree.fileSet.has(index)) {
      context.todos.push(`${index}: missing; add ${lines.map(({ text }) => text).join(' ')}`);
      return [];
    }
    const file = context.source(index);
    const { text } = file;
    const gap = text && !text.endsWith('\n') ? '\n' : '';
    const lineCount = file.getLineStarts().length;
    return lines.map((line, i) => ({
      path: index,
      start: text.length,
      end: text.length,
      text: `${i ? '' : gap}${line.text}\n`,
      line: lineCount + i + (gap ? 1 : 0),
      before: null,
      after: line.text,
    }));
  });

const addIndexLine = (context, lib, line) => context.added.set(lib.index, [...(context.added.get(lib.index) ?? []), line]);

// The statement's text with another specifier between its quotes.
const withSpecifier = (file, entry, specifier) =>
  file.text.slice(entry.node.getStart(file), entry.start + 1) + specifier + file.text.slice(entry.end - 1, entry.node.end);
