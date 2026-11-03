// Writes a planned move: the edits into the files where they are now, then the renames, then the
// removal of the folders the move emptied. Files that only move keep their mtime.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';

export const applyMoves = ({ root, layout, moves, edits }) => {
  writeEdits(root, edits);
  for (const move of moves) {
    if (move.kind === 'folder') rename(root, move.from, move.to);
    else for (const [from, to] of move.files) rename(root, from, to);
  }
  removeEmptied(
    root,
    layout,
    moves.flatMap((move) => (move.kind === 'folder' ? [posix.dirname(move.from)] : move.files.map(([from]) => posix.dirname(from)))),
  );
};

// The project's own formatters, each only when the project configures it (a binary hoisted into
// node_modules by some other package is not the project's style): eslint --fix, biome, prettier.
const FORMATTERS = [
  { tool: 'eslint', args: ['--fix'], config: /^(?:eslint\.config\.[cm]?[jt]s|\.eslintrc(?:\.[a-z]+)?)$/, key: 'eslintConfig' },
  { tool: 'biome', args: ['check', '--write'], config: /^biome\.jsonc?$/ },
  { tool: 'prettier', args: ['--write'], config: /^(?:\.prettierrc(?:\.[a-z]+)?|prettier\.config\.[cm]?[jt]s)$/, key: 'prettier' },
];

const configured = (root, { config, key }) => {
  if (readdirSync(root).some((name) => config.test(name))) return true;
  try {
    return !!key && key in JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  } catch {
    return false;
  }
};

// → { ran: [tool], todos } for the edited files.
export const formatFiles = (root, paths) => {
  const ran = [];
  const todos = [];
  for (const formatter of FORMATTERS) {
    const binary = join(root, 'node_modules/.bin', formatter.tool + (process.platform === 'win32' ? '.cmd' : ''));
    if (!existsSync(binary) || !configured(root, formatter)) continue;
    const { status } = spawnSync(binary, [...formatter.args, ...paths], {
      cwd: root,
      stdio: 'ignore',
      shell: process.platform === 'win32',
    });
    // eslint and biome exit 1 for findings they cannot fix; lint reports those later.
    if (status === null || status > 1) todos.push(`${formatter.tool} ${formatter.args.join(' ')} failed on the edited files; run it by hand`);
    else ran.push(formatter.tool);
  }
  return { ran, todos };
};

const writeEdits = (root, edits) => {
  const byPath = new Map();
  edits.forEach((edit, order) => byPath.set(edit.path, [...(byPath.get(edit.path) ?? []), { ...edit, order }]));
  for (const [path, fileEdits] of byPath) {
    // From the end, so earlier offsets stay valid; inserts at one offset keep their listed order.
    fileEdits.sort((a, b) => b.start - a.start || b.order - a.order);
    let text = readFileSync(join(root, path), 'utf8');
    for (const edit of fileEdits) text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
    writeFileSync(join(root, path), text);
  }
};

const rename = (root, from, to) => {
  mkdirSync(dirname(join(root, to)), { recursive: true });
  if (from.toLowerCase() === to.toLowerCase()) {
    // A case-insensitive disk (APFS, NTFS) takes Foo → foo only through another name.
    const temporary = `${from}.move-${process.pid}`;
    renameSync(join(root, from), join(root, temporary));
    renameSync(join(root, temporary), join(root, to));
  } else {
    renameSync(join(root, from), join(root, to));
  }
};

// Up from each old folder while it holds nothing but Finder's .DS_Store, stopping at its package's
// root or source root.
const removeEmptied = (root, layout, dirs) => {
  const stop = (dir) => {
    const project = layout.projectOf(dir);
    return dir === '.' || dir === project || dir === (project === '.' ? 'src' : `${project}/src`);
  };
  for (const start of new Set(dirs)) {
    for (let dir = start; !stop(dir) && isEmpty(join(root, dir)); dir = posix.dirname(dir)) {
      rmSync(join(root, dir), { recursive: true });
    }
  }
};

const isEmpty = (path) => existsSync(path) && readdirSync(path).every((name) => name === '.DS_Store');
