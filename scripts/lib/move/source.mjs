// Syntax-only parsing with the project's TypeScript: the module specifiers of a file with their
// positions, and the names a module exports. A .vue, .svelte or .astro file is parsed as its script
// blocks with everything else blanked to spaces, so every offset still points into the real file.

import { readFileSync } from 'node:fs';
import { extname, join, posix } from 'node:path';
import { ts } from './typescript.mjs';

export const EMBEDDED_FILE = /\.(?:vue|svelte|astro)$/;
// The files move reads for imports.
export const CODE_FILE = /\.(?:[cm]?[jt]sx?|vue|svelte|astro)$/;

const kindOf = (path) =>
  ({
    '.ts': ts.ScriptKind.TS,
    '.mts': ts.ScriptKind.TS,
    '.cts': ts.ScriptKind.TS,
    '.tsx': ts.ScriptKind.TSX,
    '.js': ts.ScriptKind.JS,
    '.mjs': ts.ScriptKind.JS,
    '.cjs': ts.ScriptKind.JS,
    '.jsx': ts.ScriptKind.JSX,
  })[extname(path)] ?? ts.ScriptKind.TS;

// The script parts of a component file kept, the rest turned to spaces (newlines stay).
const scriptOnly = (path, text) => {
  const ranges = [];
  if (path.endsWith('.astro') && text.startsWith('---')) {
    const end = text.indexOf('\n---', 3);
    if (end > 0) ranges.push([3, end]);
  }
  for (const match of text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
    const start = match.index + match[0].indexOf('>') + 1;
    ranges.push([start, start + match[1].length]);
  }
  let out = '';
  let at = 0;
  for (const [start, end] of ranges.sort((a, b) => a[0] - b[0])) {
    out += text.slice(at, start).replace(/[^\n]/g, ' ') + text.slice(start, end);
    at = end;
  }
  return out + text.slice(at).replace(/[^\n]/g, ' ');
};

export const createSources = (root) => {
  const cache = new Map();
  return (path) => {
    if (!cache.has(path)) {
      const raw = readFileSync(join(root, path), 'utf8');
      const embedded = EMBEDDED_FILE.test(path);
      const text = embedded ? scriptOnly(path, raw) : raw;
      cache.set(path, ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, embedded ? ts.ScriptKind.TS : kindOf(path)));
    }
    return cache.get(path);
  };
};

export const lineOf = (source, node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

export const hasModifier = (node, kind) => node.modifiers?.some((modifier) => modifier.kind === kind) ?? false;

// Every name an importer can take from the module, types included → line. `export * from` lines add
// no names here: follow them through importsOf.
export const exportedNames = (source) => {
  const names = new Map();
  const add = (name, node) => {
    if (!names.has(name)) names.set(name, lineOf(source, node));
  };
  for (const statement of source.statements) {
    if (ts.isExportAssignment(statement)) {
      add(statement.isExportEquals ? 'export =' : 'default', statement);
    } else if (ts.isExportDeclaration(statement)) {
      const clause = statement.exportClause;
      if (clause && ts.isNamespaceExport(clause)) add(clause.name.text, statement);
      else if (clause) for (const element of clause.elements) add(element.name.text, element);
    } else if (hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) {
        add('default', statement);
      } else if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          for (const name of bindingNames(declaration.name)) add(name, declaration);
        }
      } else if (statement.name) {
        // Functions, classes, enums, interfaces, type aliases, namespaces.
        add(statement.name.text, statement);
      }
    }
  }
  return names;
};

// Every module specifier of the file: static imports, re-exports, import() calls and import types,
// require() calls and jest|vi mock paths. start and end span the literal, quotes included.
export const importsOf = (source) => {
  const imports = [];
  const add = (node, literal, typeOnly) =>
    imports.push({
      specifier: literal.text,
      start: literal.getStart(source),
      end: literal.getEnd(),
      line: lineOf(source, node),
      typeOnly,
      node,
    });
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      add(node, node.moduleSpecifier, importsTypesOnly(node));
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      add(node, node.moduleSpecifier, exportsTypesOnly(node));
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      add(node, node.argument.literal, true);
    } else if (ts.isCallExpression(node) && isModuleCall(source, node)) {
      add(node, node.arguments[0], false);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return imports;
};

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];
// ./foo.js names foo.ts under the NodeNext convention.
const TS_FOR_JS = { '.js': ['.ts', '.tsx'], '.jsx': ['.tsx'], '.mjs': ['.mts'], '.cjs': ['.cts'] };

// The repo file a relative specifier resolves to; a guess with .ts when nothing in the tree matches.
export const resolveImport = (fileSet, from, specifier, platforms = []) => {
  if (!specifier.startsWith('.')) return null;
  const target = posix.join(posix.dirname(from), specifier).replace(/\/$/, '');
  const variants = (base) => [
    ...EXTENSIONS.map((extension) => base + extension),
    ...platforms.flatMap((platform) => EXTENSIONS.slice(0, 4).map((extension) => `${base}.${platform}${extension}`)),
  ];
  const extension = posix.extname(target);
  const candidates = [
    target,
    ...(TS_FOR_JS[extension] ?? []).map((replacement) => target.slice(0, -extension.length) + replacement),
    ...variants(target),
    ...variants(`${target}/index`),
  ];
  return candidates.find((candidate) => fileSet.has(candidate)) ?? `${target}.ts`;
};

// The declaration itself is `import type …` or `export type … from`.
export const isTypeOnlyDeclaration = (node) => (ts.isImportDeclaration(node) ? isTypeImport(node.importClause) : node.isTypeOnly);

// `import type …`: TypeScript 6 marks it with phaseModifier, 5.x with isTypeOnly.
const isTypeImport = (clause) =>
  !!clause && ('phaseModifier' in clause ? clause.phaseModifier === ts.SyntaxKind.TypeKeyword : !!clause.isTypeOnly);

// `import type { A }`, or named bindings that are all marked `type`.
const importsTypesOnly = (node) => {
  const clause = node.importClause;
  const named = clause?.namedBindings;
  return (
    isTypeImport(clause) ||
    (!!clause && !clause.name && !!named && ts.isNamedImports(named) && named.elements.length > 0 && named.elements.every((element) => element.isTypeOnly))
  );
};

const exportsTypesOnly = (node) => {
  const clause = node.exportClause;
  return (
    node.isTypeOnly ||
    (!!clause && ts.isNamedExports(clause) && clause.elements.length > 0 && clause.elements.every((element) => element.isTypeOnly))
  );
};

// import('…'), require('…'), require.resolve('…'), jest.mock('…') and the like: a call whose first
// argument is a module path.
const MODULE_CALL = /^(require|require\.resolve|(jest|vi)\.(mock|doMock|unmock|requireActual|requireMock|importActual|importMock))$/;

const isModuleCall = (source, node) =>
  !!node.arguments[0] &&
  ts.isStringLiteral(node.arguments[0]) &&
  (node.expression.kind === ts.SyntaxKind.ImportKeyword || MODULE_CALL.test(node.expression.getText(source)));

const bindingNames = (name) =>
  ts.isIdentifier(name)
    ? [name.text]
    : name.elements.flatMap((element) => (ts.isOmittedExpression(element) ? [] : bindingNames(element.name)));
