// The moves the arguments ask for: module groups expanded, refusals checked, and the old → new
// mapping of every moved path. A file, or a module path without extension, names its whole group:
// the base file, its platform variants and same-base tests and stories (an image: its @2x and @3x).

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { SCRIPT_FILE, within } from '../layout.mjs';

const TEST_SUFFIX = /\.(?:test|spec|integration|stories|story)$/;
const DENSITY = /@\d+(?:\.\d+)?x$/;
// Folders that are not the project's own code: nothing moves into or out of them.
const FOREIGN = new Set(['node_modules', '.git', '.next', '.expo', '.turbo', '.nx', 'Pods', '__pycache__', '.venv', 'venv']);
// ./foo.js names foo.ts under the NodeNext convention, so a moved .ts file is also mapped by its .js name.
const JS_FOR_TS = { '.ts': ['.js'], '.tsx': ['.jsx', '.js'], '.mts': ['.mjs'], '.cts': ['.cjs'] };

// A move that must not happen: nothing is written, exit code 2.
export class Refusal extends Error {}

// [{ from, to }] → [{ kind, from, to, files: [[old, new]] }]. A folder moves whole; any other argument
// names a group of files. Every refusal comes before anything is written, so a move never stops halfway.
// routes: the user agreed to move files whose paths are URLs.
export const expandMoves = ({ root, tree, layout, pairs, routes = false }) => {
  const moves = pairs.map((pair) => expandMove({ root, tree, layout, pair, routes }));
  checkApart(moves);
  return moves;
};

// Old repo path → new one, or null when it does not move: a moved file by its full name, its name
// without extension (./Foo.ios), its module path (./Foo) and its .js name; then a moved folder by prefix.
export const createMapPath = (moves, layout) => {
  const exact = new Map();
  const module = (path) => modulePath(path, layout.platforms);
  for (const { files } of moves) {
    for (const [from, to] of files) {
      exact.set(from, to);
      exact.set(from.replace(SCRIPT_FILE, ''), to.replace(SCRIPT_FILE, ''));
      exact.set(module(from), module(to));
      const extension = posix.extname(from);
      for (const js of JS_FOR_TS[extension] ?? []) {
        if (to.endsWith(extension)) exact.set(from.slice(0, -extension.length) + js, to.slice(0, -extension.length) + js);
      }
      // ./icons points at icons/index.ts.
      if (module(from).endsWith('/index') && module(to).endsWith('/index')) exact.set(posix.dirname(from), posix.dirname(to));
    }
  }
  const folders = moves.filter(({ kind }) => kind === 'folder');
  return (path) => {
    if (exact.has(path)) return exact.get(path);
    const folder = folders.find(({ from }) => within(path, from));
    return folder ? folder.to + path.slice(folder.from.length) : null;
  };
};

const expandMove = ({ root, tree, layout, pair, routes }) => {
  const from = normalize(pair.from);
  const to = normalize(pair.to);
  if (from === to) throw new Refusal(`${from} → ${to} moves nothing`);
  for (const path of [from, to]) checkPlace(layout, path, routes);
  checkParents(root, to);
  if (tree.dirs.has(from)) {
    if (within(to, from)) throw new Refusal(`${to} is inside ${from}`);
    checkFree(root, from, to);
    const files = tree.files.filter((path) => within(path, from)).map((path) => [path, to + path.slice(from.length)]);
    checkEntries(layout, files);
    return { kind: 'folder', from, to, files };
  }

  const dir = posix.dirname(from);
  const siblings = tree.dirs.get(dir)?.files ?? [];
  // An existing file that is not a script is an asset; anything else names a module.
  const asset = siblings.includes(posix.basename(from)) && !SCRIPT_FILE.test(from);
  const { base, kind } = splitName(posix.basename(from), asset, layout.platforms);
  const names = siblings.filter((name) => {
    const other = splitName(name, !SCRIPT_FILE.test(name), layout.platforms);
    return other.base === base && other.kind === kind;
  });
  if (!names.length) throw new Refusal(`no such file or folder: ${from}`);
  const newBase = splitName(posix.basename(to), asset, layout.platforms).base;
  const suffix = posix.basename(from).slice(base.length);
  const newSuffix = posix.basename(to).slice(newBase.length);
  if (newSuffix && newSuffix !== suffix) {
    throw new Refusal(`${to} changes the suffix '${suffix}' of ${from}; keep it or give the new name alone`);
  }
  // <to> names the moved file itself, never a folder to put it in.
  if (pair.to.endsWith('/') || isDirectory(join(root, to))) {
    throw new Refusal(`${to} is a folder; give the full new path, e.g. ${to}/${posix.basename(from)}`);
  }
  checkFree(root, from, to);
  const newDir = posix.dirname(to);
  const prefix = (folder) => (folder === '.' ? '' : `${folder}/`);
  const files = names.map((name) => [`${prefix(dir)}${name}`, `${prefix(newDir)}${newBase}${name.slice(base.length)}`]);
  checkEntries(layout, files);
  for (const [path, newPath] of files) checkFree(root, path, newPath);
  return { kind: 'group', from: `${prefix(dir)}${base}`, to: `${prefix(newDir)}${newBase}`, files };
};

const checkPlace = (layout, path, routes) => {
  if (path === '.' || path === '') throw new Refusal('the repository root does not move');
  if (path === '..' || path.startsWith('../') || posix.isAbsolute(path)) throw new Refusal(`${path} is outside the repository`);
  const foreign = path.split('/').find((segment) => FOREIGN.has(segment));
  if (foreign) throw new Refusal(`${path} is inside ${foreign}, which is not the project's code`);
  const project = layout.projectOf(path);
  if (project !== '.' && path === project) {
    throw new Refusal(`${path} is a package root: moving a package changes the workspace config, do it by hand`);
  }
  if (path === (project === '.' ? 'src' : `${project}/src`)) throw new Refusal(`${path} is a source root`);
  if (!routes) {
    const route = layout.routes.find((dir) => within(path, dir) || within(dir, path));
    if (route) {
      throw new Refusal(`${path} touches the route folder ${route}: its file paths are URLs; pass --routes once the user agreed to change them`);
    }
  }
};

// A file an alias or a package manifest names stays: those configs are not rewritten.
const checkEntries = (layout, files) => {
  const entry = files.find(([path]) => layout.entries.has(path));
  if (entry) throw new Refusal(`${entry[0]} is the entry of ${layout.entries.get(entry[0])}; move it by hand with its config`);
};

// mkdir cannot make a folder where a file is.
const checkParents = (root, to) => {
  for (let dir = posix.dirname(to); dir !== '.'; dir = posix.dirname(dir)) {
    const path = join(root, dir);
    if (existsSync(path) && !isDirectory(path)) throw new Refusal(`${dir} is a file, so ${to} cannot be made`);
  }
};

// A case-only rename finds its own source on a case-insensitive disk (APFS, NTFS) and may go on,
// unless the folder already lists the new name itself (a case-sensitive disk holding both).
const checkFree = (root, from, to) => {
  if (!existsSync(join(root, to))) return;
  const caseOnly = from.toLowerCase() === to.toLowerCase() && !readdirSync(join(root, posix.dirname(to))).includes(posix.basename(to));
  if (!caseOnly) throw new Refusal(`${to} already exists`);
};

// Moves of one run stay apart: no source inside another source, no target inside another target or
// inside another move's source. Compared without case: APFS takes Foo and foo as one.
const checkApart = (moves) => {
  const sides = moves.map((move) =>
    move.kind === 'folder'
      ? { sources: [move.from], targets: [move.to] }
      : { sources: move.files.map(([from]) => from), targets: move.files.map(([, to]) => to) },
  );
  sides.forEach((side, i) =>
    sides.forEach((other, j) => {
      if (i === j) return;
      const clash = (paths, others) => paths.find((path) => others.some((dir) => within(path.toLowerCase(), dir.toLowerCase())));
      const overlap = clash(side.sources, other.sources);
      if (overlap) throw new Refusal(`moves overlap at ${overlap}`);
      const collision = clash(side.targets, other.targets) ?? clash(side.targets, other.sources);
      if (collision) throw new Refusal(`moves collide at ${collision}`);
    }),
  );
};

// The files of a group share base and kind and differ only after the base:
// Foo.ios.test.tsx → { base: 'Foo', kind: 'module' }, icon@2x.png → { base: 'icon', kind: '.png' }
// (Metro picks icon@2x.png or icon@3x.png for require('./icon.png') by screen density).
export const splitName = (name, asset, platforms) => {
  if (asset) {
    const extension = posix.extname(name);
    const stem = extension ? name.slice(0, -extension.length) : name;
    return { base: stem.replace(DENSITY, ''), kind: extension };
  }
  const stem = name.replace(SCRIPT_FILE, '').replace(TEST_SUFFIX, '');
  const dot = stem.lastIndexOf('.');
  const platform = dot > 0 && platforms.includes(stem.slice(dot + 1));
  return { base: platform ? stem.slice(0, dot) : stem, kind: 'module' };
};

const modulePath = (path, platforms) => {
  const dir = posix.dirname(path);
  const base = splitName(posix.basename(path), false, platforms).base;
  return dir === '.' ? base : `${dir}/${base}`;
};

const isDirectory = (path) => existsSync(path) && statSync(path).isDirectory();

const normalize = (path) => posix.normalize(path).replace(/\/$/, '');
