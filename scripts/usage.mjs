#!/usr/bin/env node
// /hecpack:usage: tokens and money spent by Claude Code in one project, per model and per day, on a local
// page with the before/after around the day hecpack was set up. Reads the transcripts Claude Code already
// keeps under ~/.claude/projects, so nothing is collected during work and nothing in the project changes.
//
//   node usage.mjs --project <dir> --out <dir> [--lang en|ru] [--marker YYYY-MM-DD] [--open] [--json]
//                  [--claude-home <dir>] [--prices <file>] [--no-cache]
//
// The page and report.json go to <out>/<project slug>/; cache.json there holds the parsed transcripts, so
// a later run reads only the files that changed.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLUGIN_ROOT, pluginVersion } from './lib/setup.mjs';
import { hecpackMarker, readMessages, transcriptFiles, usageReport, usageText } from './lib/usage.mjs';

export const parseArgs = (argv) => {
  const args = { lang: 'en', open: false, json: false, cache: true };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--open' || arg === '--json') args[arg.slice(2)] = true;
    else if (arg === '--no-cache') args.cache = false;
    else if (arg.startsWith('--')) {
      const [key, inline] = arg.slice(2).split('=');
      args[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = inline ?? argv[++i];
    }
  }
  if (args.marker && !/^\d{4}-\d{2}-\d{2}$/.test(args.marker)) throw new Error('--marker must be a date, YYYY-MM-DD');
  if (!['en', 'ru'].includes(args.lang)) throw new Error('--lang must be en or ru');
  return args;
};

const slugOf = (root) => `${basename(root)}-${createHash('sha1').update(root).digest('hex').slice(0, 6)}`;

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
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
  const dir = join(resolve(args.out), slugOf(root));
  mkdirSync(dir, { recursive: true });
  const prices = readJson(args.prices ?? join(PLUGIN_ROOT, 'catalog/prices.json'));
  if (!prices?.models) throw new Error('prices file not readable');

  const files = transcriptFiles(root, args.claudeHome);
  const cacheFile = join(dir, 'cache.json');
  const { messages, cache } = readMessages(files, args.cache ? readJson(cacheFile) : undefined);
  writeFileSync(cacheFile, JSON.stringify(cache));

  const marker = args.marker ?? hecpackMarker(root);
  const report = {
    ...usageReport({ messages, prices, marker }),
    root,
    lang: args.lang,
    generatedAt: (args.date ?? new Date().toISOString()).slice(0, 19),
    version: pluginVersion(),
    transcripts: files.length,
  };
  writeFileSync(join(dir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  const html = join(dir, 'index.html');
  writeFileSync(html, page(report));
  if (args.open) openFile(html);
  return { report, dir, html, files: files.length };
};

export const summary = (result) => {
  const ru = result.report.lang === 'ru';
  return [
    usageText(result.report, result.report.lang),
    ru ? `Транскриптов: ${result.files}. Страница: ${result.html}` : `Transcripts: ${result.files}. Page: ${result.html}`,
  ].join('\n');
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = usage(args);
    console.log(args.json ? JSON.stringify(result.report, null, 2) : summary(result));
  } catch (error) {
    console.error(`hecpack usage: ${error.message}`);
    process.exit(1);
  }
}
