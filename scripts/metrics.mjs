#!/usr/bin/env node
// /hecpack:metrics: a snapshot of the project's metrics, stored outside the project, and the comparison
// with the previous snapshot. Read-only for the project.
//
//   node metrics.mjs --project <dir> --out <dir> [--days 30] [--compare] [--json]
//
// Snapshots go to <out>/<project slug>/<timestamp>.json; --compare prints the table between the newest
// earlier snapshot and this one (or, with --compare only, between the two newest stored ones).

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compare, compareTable, snapshot, snapshotText } from './lib/metrics.mjs';

export const parseArgs = (argv) => {
  const args = { days: 30, compare: false, json: false, save: true };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--compare' || arg === '--json') args[arg.slice(2)] = true;
    else if (arg === '--no-save') args.save = false;
    else if (arg.startsWith('--')) {
      const [key, inline] = arg.slice(2).split('=');
      args[key] = inline ?? argv[++i];
    }
  }
  args.days = Number(args.days);
  if (!Number.isInteger(args.days) || args.days < 1) throw new Error('--days must be a positive integer');
  return args;
};

const slugOf = (root) => `${basename(root)}-${createHash('sha1').update(root).digest('hex').slice(0, 6)}`;

const stored = (dir) =>
  existsSync(dir)
    ? readdirSync(dir).filter((name) => name.endsWith('.json')).sort().map((name) => ({ file: join(dir, name), snap: JSON.parse(readFileSync(join(dir, name), 'utf8')) }))
    : [];

export const metrics = (args) => {
  const root = resolve(args.project ?? process.cwd());
  if (!args.out) throw new Error('--out is required');
  const dir = join(resolve(args.out), slugOf(root));
  const earlier = stored(dir);
  const snap = snapshot({ root, days: args.days, date: args.date ? new Date(args.date) : new Date() });
  let file;
  if (args.save) {
    mkdirSync(dir, { recursive: true });
    file = join(dir, `${snap.takenAt.replace(/[:.]/g, '-')}.json`);
    writeFileSync(file, `${JSON.stringify(snap, null, 2)}\n`);
  }
  const previous = earlier.at(-1);
  return {
    snapshot: snap,
    file,
    dir,
    previous: previous?.file,
    comparison: previous ? compare(previous.snap, snap) : undefined,
    table: previous ? compareTable(previous.snap, snap) : undefined,
    earlierCount: earlier.length,
  };
};

export const summary = (result) => {
  const lines = [snapshotText(result.snapshot)];
  if (result.file) lines.push(`Saved to ${result.file} (${result.earlierCount} earlier snapshot${result.earlierCount === 1 ? '' : 's'} in ${result.dir}).`);
  if (result.table) lines.push('', `Compared with ${basename(result.previous)}:`, result.table);
  else lines.push('No earlier snapshot to compare with; run again after some time of use.');
  return lines.join('\n');
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = metrics(args);
    console.log(args.json ? JSON.stringify(result, null, 2) : summary(result));
  } catch (error) {
    console.error(`hecpack metrics: ${error.message}`);
    process.exit(1);
  }
}
