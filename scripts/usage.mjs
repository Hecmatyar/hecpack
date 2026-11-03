#!/usr/bin/env node
// /hecpack:usage: tokens and money spent by Claude Code in one project, per model and per day, on a local
// page with the before/after around the day hecpack was set up. Reads the transcripts Claude Code already
// keeps under ~/.claude/projects; nothing in the project changes and no model is called.
//
//   node usage.mjs --project <dir> --out <dir> [--marker YYYY-MM-DD] [--open] [--json]
//                  [--history-days 7|N|all] [--rebuild] [--quiet] [--claude-home <dir>] [--prices <file>]
//
// <out>/<project slug>/ holds store.json (what earlier runs parsed, see lib/usage.mjs), report.json and
// index.html. The first run for a project counts the last --history-days (7 by default); every later run
// reads only the transcripts that changed and keeps the ones Claude Code has deleted since. The SessionStart
// hook (hooks/usage-sync.mjs) runs this with --quiet in the background, so the page is current when opened.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLUGIN_ROOT, pluginVersion } from './lib/setup.mjs';
import { hecpackMarker, readMessages, transcriptFiles, usageReport, usageText } from './lib/usage.mjs';

export const parseArgs = (argv) => {
  const args = { open: false, json: false, rebuild: false, quiet: false, historyDays: 7 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (['--open', '--json', '--rebuild', '--quiet'].includes(arg)) args[arg.slice(2)] = true;
    else if (arg.startsWith('--')) {
      const [key, inline] = arg.slice(2).split('=');
      args[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = inline ?? argv[++i];
    }
  }
  if (args.marker && !/^\d{4}-\d{2}-\d{2}$/.test(args.marker)) throw new Error('--marker must be a date, YYYY-MM-DD');
  args.historyDays = args.historyDays === 'all' ? 0 : Number(args.historyDays);
  if (!Number.isInteger(args.historyDays) || args.historyDays < 0) throw new Error('--history-days must be a number of days or all');
  return args;
};

export const slugOf = (root) => `${basename(root)}-${createHash('sha1').update(root).digest('hex').slice(0, 6)}`;
export const storeDir = (out, root) => join(resolve(out), slugOf(resolve(root)));

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
};

// Two sessions may start at once: write a temp file and rename it, so a reader never sees half a file.
const writeAtomic = (file, text) => {
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, text);
  renameSync(temp, file);
};

// The page reads the report from an inline script; `</` would close it early.
const page = (report) =>
  readFileSync(join(PLUGIN_ROOT, 'scripts/usage-page.html'), 'utf8').replace('/*__REPORT__*/null', () => JSON.stringify(report).replace(/</g, '\\u003c'));

const openFile = (file) => {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  spawnSync(opener, [file], { stdio: 'ignore' });
};

export const usage = (args) => {
  const root = resolve(args.project ?? process.cwd());
  if (!args.out) throw new Error('--out is required');
  const dir = storeDir(args.out, root);
  mkdirSync(dir, { recursive: true });
  const prices = readJson(args.prices ?? join(PLUGIN_ROOT, 'catalog/prices.json'));
  if (!prices?.models) throw new Error('prices file not readable');

  const storeFile = join(dir, 'store.json');
  const earlier = readJson(storeFile);
  const files = transcriptFiles(root, args.claudeHome);
  const now = args.date ? Date.parse(args.date) : Date.now();
  const { messages, store, stats } = readMessages(files, earlier, { historyDays: args.historyDays, now, rebuild: args.rebuild });
  writeAtomic(storeFile, JSON.stringify(store));

  const marker = args.marker ?? hecpackMarker(root);
  const report = {
    ...usageReport({ messages, prices, marker }),
    root,
    generatedAt: new Date(now).toISOString().slice(0, 19),
    version: pluginVersion(),
    transcripts: stats.files,
    history: { from: store.from, firstRun: stats.firstRun, read: stats.read, gone: stats.gone, createdAt: store.createdAt },
  };
  writeAtomic(join(dir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  const html = join(dir, 'index.html');
  writeAtomic(html, page(report));
  if (args.open) openFile(html);
  return { report, dir, html, stats };
};

export const summary = (result) => {
  const { report, stats } = result;
  const from = report.history.from;
  const head = report.history.firstRun
    ? `First count: ${from ? `history from ${from}` : 'the whole history'}; every later run reads only the new sessions.`
    : `History from ${from ?? 'the start'}; read again: ${stats.read} of ${stats.files} transcripts${stats.gone ? `, ${stats.gone} more already deleted by Claude Code, their totals kept` : ''}.`;
  return [head, usageText(report), `Page: ${result.html}`].join('\n');
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = usage(args);
    if (!args.quiet) console.log(args.json ? JSON.stringify(result.report, null, 2) : summary(result));
  } catch (error) {
    if (!process.argv.includes('--quiet')) {
      console.error(`hecpack usage: ${error.message}`);
      process.exit(1);
    }
  }
}
