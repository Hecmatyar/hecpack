// Moves files and folders and rewrites every specifier that pointed at them: relative imports, the
// project's aliases, package entries and their export lines, across packages too. The project's own
// layout (layout.mjs) says where packages, aliases, platform suffixes and route folders are.

import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { within } from '../layout.mjs';
import { applyMoves, formatFiles } from './apply.mjs';
import { resolveCrossings } from './crossProject.mjs';
import { findMentions } from './mentions.mjs';
import { createMapPath, expandMoves, Refusal } from './paths.mjs';
import { planEdits } from './plan.mjs';
import { CODE_FILE, createSources } from './source.mjs';
import { readTree } from './tree.mjs';
import { loadTypeScript, TYPESCRIPT_MISSING } from './typescript.mjs';

// Output stays short enough to read: longer lists end with a count.
const LIMITS = { edits: 80, edited: 80, mentions: 30 };

// moves: [{ from, to }] as repo paths; validation: detect.detectValidation's commands, for the last line.
// → { exitCode: 0 clean | 1 to-dos left | 2 refused, lines }.
export const move = ({ root, layout, moves: pairs, dryRun = false, format = true, routes = false, validation = [] }) => {
  if (!loadTypeScript(root)) return { exitCode: 2, lines: [`move: refused: ${TYPESCRIPT_MISSING}`] };
  const tree = readTree(root);
  let moves;
  try {
    moves = expandMoves({ root, tree, layout, pairs, routes });
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    return { exitCode: 2, lines: [`move: refused: ${error.message}`] };
  }

  const source = createSources(root);
  const mapPath = createMapPath(moves, layout);
  const files = linkingFiles(root, tree, layout, moves, mapPath);
  const planned = planEdits({ tree, source, mapPath, layout, files });
  const crossed = resolveCrossings({ tree, source, layout, moves, mapPath, files, ...planned });
  const edits = [...planned.edits, ...crossed.edits];
  const todos = [...crossed.todos];
  const edited = [...new Set(edits.map(({ path }) => mapPath(path) ?? path))].sort();
  const lines = moves.flatMap(describeMove);

  if (dryRun) {
    lines.push(...capped(sortEdits(edits).map(describeEdit), LIMITS.edits, 'edits'));
  } else {
    applyMoves({ root, layout, moves, edits });
    lines.push(...capped(edited.map((path) => `edited ${path}`), LIMITS.edited, 'files'));
    if (format && edited.length) {
      const formatted = formatFiles(root, edited);
      if (formatted.ran.length) lines.push(`formatted with ${formatted.ran.join(', ')}`);
      todos.push(...formatted.todos);
    }
  }
  lines.push(...todos.map((todo) => `todo: ${todo}`));
  const skip = new Set(edits.map(({ path, line }) => `${path}:${line}`));
  const mentions = findMentions({ root, tree, layout, paths: moves.map(({ from }) => from), skip });
  lines.push(...capped(mentions.map((mention) => `mention (not rewritten): ${mention}`), LIMITS.mentions, 'mentions'));
  lines.push(dryRun ? 'dry run: nothing written' : nextStep(layout, moves, edited, validation));
  return { exitCode: todos.length ? 1 : 0, lines };
};

// The code files that can link to a moved path, the rest is never parsed: the moved files, the files
// under a moved index's folder (`'.'` and `'..'` name a folder without its name), and the files whose
// text names a moved base or folder, the alias of a package the move touches, or the prefix of an alias
// that points into a moved folder.
const linkingFiles = (root, tree, layout, moves, mapPath) => {
  const keys = new Set();
  const near = [];
  for (const { from, to } of moves) {
    const name = posix.basename(from);
    keys.add(name);
    if (name === 'index') {
      keys.add(posix.basename(posix.dirname(from)));
      near.push(posix.dirname(from));
    }
    for (const side of [from, to]) {
      const lib = layout.libs.get(layout.projectOf(side));
      if (lib) keys.add(lib.alias);
    }
  }
  for (const alias of layout.aliases) {
    if (!alias.wildcard) continue;
    const heads = alias.targets.map((target) => target.split('*')[0].replace(/\/$/, ''));
    if (heads.some((head) => moves.some(({ from }) => within(head, from)))) keys.add(alias.prefix);
  }
  return tree.files.filter((path) => {
    if (!CODE_FILE.test(path)) return false;
    if (mapPath(path) !== null || near.some((dir) => within(path, dir))) return true;
    const text = readFileSync(join(root, path), 'utf8');
    for (const key of keys) if (text.includes(key)) return true;
    return false;
  });
};

const capped = (lines, limit, what) =>
  lines.length > limit ? [...lines.slice(0, limit), `… and ${lines.length - limit} more ${what}`] : lines;

// A folder is one line; a module group lists each file.
const describeMove = ({ kind, from, to, files }) =>
  kind === 'folder' ? [`move ${from} → ${to} (${files.length} files)`] : files.map(([file, newFile]) => `move ${file} → ${newFile}`);

const describeEdit = ({ path, line, before, after }) => {
  const flat = (text) => text.replace(/\s+/g, ' ');
  const change = before === null ? `+ ${flat(after)}` : after === null ? `- ${flat(before)}` : `${flat(before)} → ${flat(after)}`;
  return `${path}:${line} ${change}`;
};

const sortEdits = (edits) => [...edits].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) || a.start - b.start);

// The packages a move touched, and the project's own check for them: a scoped command (nx -p) when the
// project has one, else its commands as they are.
const nextStep = (layout, moves, edited, validation) => {
  const projects = [...new Set([...moves.flatMap(({ from, to }) => [from, to]), ...edited].map(layout.projectOf))].sort();
  const names = projects.map((dir) => {
    const item = layout.packages.find((pkg) => pkg.dir === dir);
    return item?.project ?? item?.name ?? dir;
  });
  const scoped = validation.find((item) => item.scoped);
  if (scoped && !projects.includes('.')) return `next: ${scoped.scoped.replace('<project>', names.join(','))}`;
  if (validation.length) return `next: ${validation.map((item) => item.command).join(' && ')}`;
  return `next: typecheck and lint ${names.join(', ')}`;
};
