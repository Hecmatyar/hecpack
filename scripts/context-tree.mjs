#!/usr/bin/env node
// /hecpack:context: the context tree of a project on a local page. For each main-session mode and each
// agent: what reaches its context at start (Claude Code's own files, the hecpack hook, the agent body) and
// what it may read by link; the rules that load by path, the docs nobody reaches, the files that repeat
// each other, and the change since the previous run. Read-only for the project; no model call.
//
//   node context-tree.mjs --project <dir> --out <dir> [--lang en|ru] [--open] [--json] [--claude-home <dir>]

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contextTree, treeText } from './lib/context-tree.mjs';
import { PLUGIN_ROOT, pluginVersion } from './lib/setup.mjs';
import { storeDir } from './usage.mjs';

const HISTORY = 30;

export const parseArgs = (argv) => {
  const args = { open: false, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--open' || arg === '--json') args[arg.slice(2)] = true;
    else if (arg.startsWith('--')) {
      const [key, inline] = arg.slice(2).split('=');
      args[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = inline ?? argv[++i];
    }
  }
  if (args.lang && !['en', 'ru'].includes(args.lang)) throw new Error('--lang must be en or ru');
  return args;
};

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
};

const writeAtomic = (file, text) => {
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, text);
  renameSync(temp, file);
};

const page = (report) =>
  readFileSync(join(PLUGIN_ROOT, 'scripts/context-tree-page.html'), 'utf8').replace('/*__REPORT__*/null', () => JSON.stringify(report).replace(/</g, '\\u003c'));

const openFile = (file) => {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  spawnSync(opener, [file], { stdio: 'ignore' });
};

export const run = (args) => {
  const root = resolve(args.project ?? process.cwd());
  if (!args.out) throw new Error('--out is required');
  const dir = storeDir(args.out, root);
  mkdirSync(dir, { recursive: true });
  const tree = contextTree({ root, claudeHome: args.claudeHome, pluginRoot: PLUGIN_ROOT });
  const config = readJson(join(root, '.claude/hecpack/config.json'));
  const lang = args.lang ?? readJson(join(dir, 'report.json'))?.lang ?? (config?.language === 'ru' ? 'ru' : 'en');
  const at = (args.date ?? new Date().toISOString()).slice(0, 19);

  // One entry per run that changed something, so the page can say what moved since the last change.
  const historyFile = join(dir, 'history.json');
  const history = readJson(historyFile) ?? [];
  const entry = { at, readers: Object.fromEntries(tree.readers.map((reader) => [reader.id, [reader.mustTok, reader.optionalTok]])) };
  const last = history.at(-1);
  const changed = !last || JSON.stringify(last.readers) !== JSON.stringify(entry.readers);
  const previous = changed ? last : history.at(-2);
  if (changed) {
    history.push(entry);
    writeAtomic(historyFile, JSON.stringify(history.slice(-HISTORY)));
  }

  const report = { ...tree, lang, generatedAt: at, version: pluginVersion(), previous };
  writeAtomic(join(dir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  const html = join(dir, 'index.html');
  writeAtomic(html, page(report));
  if (args.open) openFile(html);
  return { report, dir, html };
};

export const summary = (result) => {
  const ru = result.report.lang === 'ru';
  return [treeText(result.report, result.report.lang), ru ? `Страница: ${result.html}` : `Page: ${result.html}`].join('\n');
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = run(args);
    console.log(args.json ? JSON.stringify(result.report, null, 2) : summary(result));
  } catch (error) {
    console.error(`hecpack context: ${error.message}`);
    process.exit(1);
  }
}
