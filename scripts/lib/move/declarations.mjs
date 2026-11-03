// Text edits of import and export declarations: elements regrouped by the module they now
// come from, a statement's lines removed.

import { isTypeOnlyDeclaration, lineOf } from '../code/source.mjs';
import { ts } from '../code/typescript.mjs';
import { specifierEdit } from './plan.mjs';

// One file's declarations whose elements now come from other modules (changes: [{ node, groups:
// specifier → element texts }]). A declaration keeps the elements that stay; the others join a
// declaration of the same kind that already takes their module (specifiers: a declaration's
// specifier after the planned edits), or form a new declaration in its place, which then takes
// in the later elements for that module too.
export const regroup = (path, file, changes, specifiers) => {
  const changed = new Set(changes.map(({ node }) => node));
  // Declaration key → { node, texts } for an existing declaration, { specifier, texts } for a new one.
  const hosts = new Map();
  for (const statement of file.statements) {
    if (changed.has(statement) || !namedElements(statement)) continue;
    const specifier =
      specifiers.get(statement) ?? statement.moduleSpecifier.text;
    const key = declarationKey(statement, specifier);
    if (!hosts.has(key)) hosts.set(key, { node: statement, texts: [] });
  }

  // What each changed declaration becomes; the elements that stay come first.
  const declarations = new Map(changes.map(({ node }) => [node, []]));
  for (const { node, groups } of changes) {
    for (const [specifier, texts] of groups) {
      if (!texts.length) continue;
      if (specifier === node.moduleSpecifier.text) {
        declarations.get(node).push({ specifier, texts });
        continue;
      }
      const key = declarationKey(node, specifier);
      const host = hosts.get(key);
      if (host) {
        host.texts.push(...texts);
      } else {
        const created = { specifier, texts: [...texts] };
        hosts.set(key, created);
        declarations.get(node).push(created);
      }
    }
  }

  const rewrites = changes.map(({ node }) =>
    rewrite(path, file, node, declarations.get(node)),
  );
  const joins = [...hosts.values()]
    .filter(({ node, texts }) => node && texts.length)
    .map((host) => joinInto(path, file, host));
  return [...rewrites, ...joins];
};

// A declaration as its new declarations: a specifier edit when it moves whole and unchanged
// (its formatting stays), a removal when all its elements joined other declarations.
const rewrite = (path, file, node, declarations) => {
  if (!declarations.length) return removal(path, file, node);
  const [first] = declarations;
  const texts = namedElements(node).map((element) => element.getText());
  if (declarations.length === 1 && first.texts.join() === texts.join()) {
    const entry = {
      specifier: node.moduleSpecifier.text,
      start: node.moduleSpecifier.getStart(file),
      end: node.moduleSpecifier.end,
      line: lineOf(file, node),
      node,
    };
    return specifierEdit(path, entry, first.specifier);
  }
  const text = declarations
    .map(({ specifier, texts }) => declarationText(node, specifier, texts))
    .join('\n');
  return {
    path,
    start: node.getStart(file),
    end: node.end,
    text,
    line: lineOf(file, node),
    before: node.getText(file),
    after: text,
  };
};

// Appends elements to a declaration that already takes their module.
const joinInto = (path, file, { node, texts }) => {
  const at = namedElements(node).at(-1).end;
  const text = `, ${texts.join(', ')}`;
  const start = node.getStart(file);
  const before = node.getText(file);
  return {
    path,
    start: at,
    end: at,
    text,
    line: lineOf(file, node),
    before,
    after: before.slice(0, at - start) + text + before.slice(at - start),
  };
};

// Removes the whole lines a statement takes, a trailing comment included.
export const removal = (path, file, node) => {
  const starts = file.getLineStarts();
  const first = file.getLineAndCharacterOfPosition(node.getStart(file)).line;
  const last = file.getLineAndCharacterOfPosition(node.end).line;
  return {
    path,
    start: starts[first],
    end: starts[last + 1] ?? file.text.length,
    text: '',
    line: first + 1,
    before: node.getText(file),
    after: null,
  };
};

// The elements of `import { … } from` and `export { … } from`; null for any other form.
export const namedElements = (node) => {
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause;
    const named = clause?.namedBindings;
    return clause && !clause.name && named && ts.isNamedImports(named)
      ? nonEmpty(named.elements)
      : null;
  }
  if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
    const clause = node.exportClause;
    return clause && ts.isNamedExports(clause)
      ? nonEmpty(clause.elements)
      : null;
  }
  return null;
};

const nonEmpty = (elements) => (elements.length ? [...elements] : null);

// The name an element takes from its module: A in `A as B`.
export const importedName = (element) =>
  (element.propertyName ?? element.name).text;

// 'import', 'import type', 'export' or 'export type'.
const keywordOf = (node) =>
  (ts.isImportDeclaration(node) ? 'import' : 'export') +
  (isTypeOnlyDeclaration(node) ? ' type' : '');

const declarationKey = (node, specifier) => `${keywordOf(node)} ${specifier}`;

const declarationText = (node, specifier, texts) => {
  const quote = node.moduleSpecifier.getText()[0];
  return `${keywordOf(node)} { ${texts.join(', ')} } from ${quote}${specifier}${quote};`;
};
