#!/usr/bin/env node
// /hecpack:arch: the project's import graph against its architecture rules, with the project's own
// TypeScript as the parser. Read-only, except --adopt after the user accepted architecture.md.
//
//   node arch.mjs [--project <dir>]               the audit summary as JSON (rules from architecture.md,
//                                                 else inferred from folder names, with the proposed block)
//   node arch.mjs --check [<file> …]              the rule breaks, of the given files only when named;
//                                                 exit 1 when an error is left
//   node arch.mjs --adopt                         loads .claude/hecpack/architecture.md with the code rules
//                                                 and the architect through the context map
//
// The project is the git work tree of the working directory (or --project); paths are relative to the
// working directory.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { audit } from './lib/arch/audit.mjs';
import { buildGraph } from './lib/arch/graph.mjs';
import { check, inferRules, readRules, SEVERITY } from './lib/arch/rules.mjs';
import { createSources } from './lib/code/source.mjs';
import { readTree } from './lib/code/tree.mjs';
import { loadTypeScript, TYPESCRIPT_MISSING } from './lib/code/typescript.mjs';
import { findWorkspaces, readJson } from './lib/detect.mjs';
import { findDocs } from './lib/docs.mjs';
import { readLayout } from './lib/layout.mjs';

export const ARCHITECTURE = '.claude/hecpack/architecture.md';
const CHECK_LIMIT = 40;

const workTree = (cwd) => {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
};

export const parseOptions = (argv, workingDir = process.cwd()) => {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { check: { type: 'boolean', default: false }, adopt: { type: 'boolean', default: false }, project: { type: 'string' } },
  });
  const cwd = realpathSync(workingDir);
  const root = realpathSync(resolve(cwd, values.project ?? workTree(cwd) ?? cwd));
  const paths = positionals.map((path) => relative(root, resolve(cwd, path)).split('\\').join('/'));
  return { root, mode: values.adopt ? 'adopt' : values.check ? 'check' : 'audit', paths };
};

const load = (root) => {
  const workspaces = findWorkspaces(root, readJson(join(root, 'package.json')));
  const layout = readLayout(root, workspaces);
  const tree = readTree(root);
  const graph = buildGraph({ root, layout, tree, source: createSources(root) });
  return { workspaces, layout, tree, graph };
};

// The architecture docs the project already keeps, for the model to read before judging.
const architectureDocs = (root, workspaces) => {
  const docs = findDocs(root, workspaces).filter((doc) => doc.kind !== 'agent' && doc.kind !== 'skill');
  const named = docs.filter((doc) => /architect|structure|layer|project-map|boundar/i.test(doc.path));
  return named.slice(0, 4).map((doc) => `${doc.path} (${doc.lines} lines)`);
};

export const runAudit = (root) => {
  const started = Date.now();
  const { workspaces, layout, tree, graph } = load(root);
  const accepted = readRules(root);
  const rules = accepted ?? inferRules(layout, tree, graph);
  const summary = audit({ graph, layout, rules, source: accepted ? ARCHITECTURE : 'inferred from folder names' });
  return {
    ...summary,
    docs: [...(existsSync(join(root, '.claude/hecpack/project-map.md')) ? ['.claude/hecpack/project-map.md'] : []), ...architectureDocs(root, workspaces)],
    ...(accepted ? {} : { proposedRules: rules }),
    seconds: Math.round((Date.now() - started) / 100) / 10,
  };
};

// → { exitCode, lines }: one line per break, errors first.
export const runCheck = (root, paths) => {
  const accepted = readRules(root);
  if (!accepted) return { exitCode: 0, lines: [`arch: no rules yet (${ARCHITECTURE}); /hecpack:arch proposes them`] };
  const { graph } = load(root);
  const found = check(graph, accepted, { paths: paths.length ? paths : undefined }).sort(
    (a, b) => (SEVERITY[a.rule] === SEVERITY[b.rule] ? 0 : SEVERITY[a.rule] === 'error' ? -1 : 1),
  );
  const errors = found.filter((item) => SEVERITY[item.rule] === 'error').length;
  const lines = found
    .slice(0, CHECK_LIMIT)
    .map((item) => `${SEVERITY[item.rule]} ${item.rule}: ${item.line ? `${item.file}:${item.line}` : item.file}${item.target ? ` → ${item.target}` : ''} (${item.note})`);
  if (found.length > CHECK_LIMIT) lines.push(`… and ${found.length - CHECK_LIMIT} more`);
  lines.push(`arch: ${errors} errors, ${found.length - errors} warnings, ${paths.length ? `${paths.length} files checked` : `${graph.nodes.size} files`}`);
  return { exitCode: errors ? 1 : 0, lines };
};

// architecture.md joins the code sessions and the architect in the context map, after stack.md.
export const runAdopt = (root) => {
  if (!existsSync(join(root, ARCHITECTURE))) return { exitCode: 2, lines: [`arch: ${ARCHITECTURE} is not written yet`] };
  const file = join(root, '.claude/hecpack/context-map.json');
  if (!existsSync(file)) return { exitCode: 0, lines: [`arch: no context map; ${ARCHITECTURE} loads once /hecpack:init has set the project up`] };
  const map = JSON.parse(readFileSync(file, 'utf8'));
  const lists = [...['code', 'e2e'].map((type) => map.types?.[type]), map.agents?.['hecpack:architect']].filter(Array.isArray);
  let added = 0;
  for (const list of lists) {
    if (list.includes(ARCHITECTURE)) continue;
    const at = list.indexOf('.claude/hecpack/stack.md');
    list.splice(at < 0 ? list.length : at + 1, 0, ARCHITECTURE);
    added += 1;
  }
  if (added) writeFileSync(file, `${JSON.stringify(map, null, 2)}\n`);
  return { exitCode: 0, lines: [added ? `arch: ${ARCHITECTURE} added to ${added} lists of the context map` : `arch: ${ARCHITECTURE} is already in the context map`] };
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let options;
  try {
    options = parseOptions(process.argv.slice(2));
  } catch (error) {
    console.error(`arch: ${error.message}`);
    process.exit(2);
  }
  if (options.mode === 'adopt') {
    const { exitCode, lines } = runAdopt(options.root);
    console.log(lines.join('\n'));
    process.exit(exitCode);
  }
  if (!loadTypeScript(options.root)) {
    console.error(`arch: ${TYPESCRIPT_MISSING}`);
    process.exit(2);
  }
  if (options.mode === 'check') {
    const { exitCode, lines } = runCheck(options.root, options.paths);
    console.log(lines.join('\n'));
    process.exitCode = exitCode;
  } else {
    console.log(JSON.stringify(runAudit(options.root), null, 1));
  }
}
