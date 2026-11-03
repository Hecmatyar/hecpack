// The architecture rules a project follows and the check of its import graph against them. Accepted rules
// live in the `hecpack-arch` block of .claude/hecpack/architecture.md; before the user accepts any,
// inferRules reads them off the folder names so the audit can show what breaks the usual ones.
//
// Rules: layers top → bottom, each with path patterns (a trailing `*` names the slice: one feature, one
// widget); `isolated` slices of a layer do not import each other; `roles`: inside any unit, components →
// hooks → store → api → lib → constants → types, never back («leaves stay leaves»); `sharedUi`: the
// shared dumb components, which import no data or feature code; `allow`: accepted exceptions with a why;
// `limits`: construction-kit size and folder size.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseJsonc, within } from '../layout.mjs';

export const ROLE_RANK = {
  components: 0,
  ui: 0,
  views: 0,
  hooks: 1,
  store: 2,
  stores: 2,
  state: 2,
  model: 2,
  models: 2,
  api: 3,
  services: 3,
  lib: 4,
  utils: 4,
  helpers: 4,
  constants: 5,
  config: 5,
  types: 6,
};
const DATA_ROLES = new Set(['store', 'stores', 'state', 'model', 'models', 'api', 'services']);

// Folder names of the usual layer schemes (feature-sliced, layered apps, Nx libraries), top first.
const LAYER_GROUPS = [
  { names: ['app', 'apps'], isolated: false },
  { names: ['pages', 'screens', 'routes', 'views'], isolated: false },
  { names: ['processes'], isolated: true },
  { names: ['widgets'], isolated: true },
  { names: ['features'], isolated: true },
  { names: ['entities', 'domain'], isolated: false },
  { names: ['shared', 'core', 'common'], isolated: false },
];
// Names that make a layer only as a package or a top folder of the root package: a slice called core
// inside features is a slice, not the base layer.
const TOP_ONLY = new Set(['core', 'common']);
const SHARED_UI = new Set(['components', 'ui', 'design-system', 'designSystem', 'kit', 'uikit', 'ui-kit']);

export const DEFAULT_LIMITS = { kitLines: 150, kitImports: 12, folderModules: 15 };
export const SEVERITY = {
  'layer-up': 'error',
  sideways: 'error',
  'dumb-smart': 'error',
  'leaf-up': 'error',
  cycle: 'error',
  'kit-size': 'warn',
  'folder-size': 'warn',
};

const escape = (text) => text.replace(/[.+^${}()|[\]\\]/g, '\\$&');

// A glob as a whole-path matcher: ** any depth, * one segment; a folder also matches what is inside it.
export const globRegExp = (glob) => {
  const body = escape(glob.replace(/\/\*\*$/, ''))
    .replace(/\*\*\//g, '\u0000')
    .replace(/\*\*/g, '\u0001')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '(?:.*/)?')
    .replace(/\u0001/g, '.*');
  return new RegExp(`^${body}(?:/.*)?$`);
};

// A layer path pattern: a folder prefix where * is one segment; a trailing /* makes the folder below it
// the slice (a file right in the prefix folder is in the layer, in no slice).
const layerRegExp = (pattern) => {
  const clean = pattern.replace(/\/$/, '');
  const sliced = clean.endsWith('/*');
  const base = escape(sliced ? clean.slice(0, -2) : clean).replace(/\*/g, '[^/]+');
  return new RegExp(`^${base}${sliced ? '(?:/([^/]+)(?=/))?' : ''}(?:/|$)`);
};

export const compileRules = (rules) => {
  const layers = (rules.layers ?? []).map((layer, index) => ({
    ...layer,
    index,
    matchers: (layer.paths ?? []).map(layerRegExp),
  }));
  const allow = (rules.allow ?? []).map((item) => ({ ...item, from: globRegExp(item.from), to: globRegExp(item.to) }));
  // The layer whose pattern matches the longest part of the path: apps/web/src/pages/* wins over apps/web.
  const layerOf = (path) => {
    let best = null;
    for (const layer of layers) {
      for (const matcher of layer.matchers) {
        const match = matcher.exec(path);
        if (match && (!best || match[0].length > best.length)) {
          best = { length: match[0].length, index: layer.index, name: layer.name, isolated: !!layer.isolated, slice: match[1] ?? null };
        }
      }
    }
    return best;
  };
  return {
    ...rules,
    layers,
    layerOf,
    roles: rules.roles !== false,
    sharedUi: rules.sharedUi ?? [],
    allowed: (from, to) => allow.some((item) => item.from.test(from) && item.to.test(to)),
    limits: { ...DEFAULT_LIMITS, ...rules.limits },
  };
};

// The deepest folder of a graph node named after a role, from its unit down: a package called
// `components` is not a role folder, `src/components` and `cards/hooks` are.
export const roleOf = (node) => {
  const top = node.unit === node.project || node.unit === '.' || /(?:^|\/)src$/.test(node.unit) ? [] : [node.unit.split('/').at(-1)];
  const segments = [...top, ...node.inner.split('/').slice(0, -1)];
  for (let i = segments.length - 1; i >= 0; i -= 1) if (segments[i] in ROLE_RANK) return segments[i];
  return null;
};

// The accepted rules from architecture.md, or null when the project has none yet.
export const readRules = (root) => {
  let text;
  try {
    text = readFileSync(join(root, '.claude/hecpack/architecture.md'), 'utf8');
  } catch {
    return null;
  }
  const block = /```hecpack-arch\s*\n([\s\S]*?)\n```/.exec(text);
  if (!block) return null;
  return parseJsonc(block[1]);
};

// Rules read off the folder names: layers from packages and code units named like the usual layers (only
// when two or more are found), role folders, shared UI folders, default limits.
export const inferRules = (layout, tree, graph) => {
  const found = new Map();
  const add = (name, pattern) => {
    const group = LAYER_GROUPS.findIndex((item) => item.names.includes(name));
    if (group < 0) return;
    if (!found.has(group)) found.set(group, new Set());
    found.get(group).add(pattern);
  };
  const nodes = [...graph.nodes.values()];
  for (const item of layout.packages) {
    // A package with no code in the graph (an e2e suite, a config package) holds no layer.
    if (item.dir === '.' || !nodes.some((node) => node.project === item.dir)) continue;
    const name = item.dir.startsWith('apps/') ? 'apps' : item.dir.split('/').at(-1);
    add(name, name === 'apps' ? item.dir : tree.dirs.has(`${item.dir}/src`) ? `${item.dir}/src/*` : `${item.dir}/*`);
  }
  const packageDirs = new Set(layout.packages.map((item) => item.dir));
  const units = new Map();
  for (const node of nodes) if (!packageDirs.has(node.unit) && !/(?:^|\/)src$/.test(node.unit)) units.set(node.unit, node.project);
  for (const [unit, project] of units) {
    const name = unit.split('/').at(-1);
    if (TOP_ONLY.has(name) && project !== '.') continue;
    add(name, LAYER_GROUPS[0].names.includes(name) ? unit : `${unit}/*`);
  }
  // A folder already inside another path of its layer adds nothing (apps/web/src/app under apps/web).
  const outermost = (patterns) => patterns.filter((path) => !patterns.some((other) => other !== path && !other.endsWith('/*') && within(path, other)));
  const layers =
    found.size >= 2
      ? [...found]
          .sort((a, b) => a[0] - b[0])
          .map(([group, patterns]) => ({ name: LAYER_GROUPS[group].names[0], paths: outermost([...patterns].sort()), isolated: LAYER_GROUPS[group].isolated }))
      : [];
  const sharedUi = [];
  for (const item of layout.packages) if (item.dir !== '.' && SHARED_UI.has(item.dir.split('/').at(-1))) sharedUi.push(item.dir);
  for (const unit of units.keys()) {
    const name = unit.split('/').at(-1);
    if (SHARED_UI.has(name) && !sharedUi.some((dir) => within(unit, dir))) sharedUi.push(unit);
    if (name === 'shared' && tree.dirs.has(`${unit}/ui`)) sharedUi.push(`${unit}/ui`);
  }
  return { layers, roles: true, sharedUi: sharedUi.sort(), allow: [], limits: { ...DEFAULT_LIMITS } };
};

// Strongly connected groups of files over runtime imports (type-only imports do not run), two or more
// files each; iterative Tarjan, so a deep graph does not overflow the stack.
export const cyclesOf = (graph) => {
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const groups = [];
  let counter = 0;
  const next = (path) => graph.nodes.get(path).imports.filter((item) => !item.typeOnly).map((item) => item.target);
  for (const start of graph.nodes.keys()) {
    if (index.has(start)) continue;
    const work = [[start, 0]];
    while (work.length) {
      const frame = work.at(-1);
      const [path, i] = frame;
      if (i === 0) {
        index.set(path, counter);
        low.set(path, counter);
        counter += 1;
        stack.push(path);
        onStack.add(path);
      }
      const targets = next(path);
      if (i < targets.length) {
        frame[1] += 1;
        const target = targets[i];
        if (!index.has(target)) work.push([target, 0]);
        else if (onStack.has(target)) low.set(path, Math.min(low.get(path), index.get(target)));
        continue;
      }
      work.pop();
      if (work.length) {
        const parent = work.at(-1)[0];
        low.set(parent, Math.min(low.get(parent), low.get(path)));
      }
      if (low.get(path) === index.get(path)) {
        const group = [];
        let item;
        do {
          item = stack.pop();
          onStack.delete(item);
          group.push(item);
        } while (item !== path);
        if (group.length > 1) groups.push(group.sort());
      }
    }
  }
  return groups.sort((a, b) => b.length - a.length);
};

// One loop through a group, as the files a reader would follow: start → … → start.
export const loopOf = (graph, group) => {
  const members = new Set(group);
  const start = group[0];
  const previous = new Map([[start, null]]);
  const queue = [start];
  while (queue.length) {
    const path = queue.shift();
    for (const { target, typeOnly } of graph.nodes.get(path).imports) {
      if (typeOnly || !members.has(target)) continue;
      if (target === start) {
        const loop = [start];
        for (let at = path; at !== start; at = previous.get(at)) loop.splice(1, 0, at);
        return [...loop, start];
      }
      if (!previous.has(target)) {
        previous.set(target, path);
        queue.push(target);
      }
    }
  }
  return group;
};

// Every import of the graph that breaks a rule, and the size warnings: [{ rule, file, line, target?,
// note }]. paths: only the files a task touched (their imports, their folders, their cycles).
export const check = (graph, rawRules, { paths } = {}) => {
  const rules = compileRules(rawRules);
  const only = paths ? new Set(paths) : null;
  const shared = (path) => rules.sharedUi.some((dir) => within(path, dir));
  const found = [];
  for (const node of graph.nodes.values()) {
    if (only && !only.has(node.path)) continue;
    const from = rules.layerOf(node.path);
    const fromRole = rules.roles ? roleOf(node) : null;
    for (const { target, line, typeOnly } of node.imports) {
      if (rules.allowed(node.path, target)) continue;
      const to = rules.layerOf(target);
      const hit = (rule, note) => found.push({ rule, file: node.path, line, target, note });
      if (from && to && to.index < from.index) {
        hit('layer-up', `${from.name} imports ${to.name}, a layer above it`);
      } else if (from && to && to.index === from.index && from.isolated && from.slice && to.slice && from.slice !== to.slice) {
        hit('sideways', `${from.name}/${from.slice} imports ${to.name}/${to.slice}: slices of one layer stay apart`);
      }
      if (!typeOnly && shared(node.path) && !shared(target)) {
        const role = roleOf(graph.nodes.get(target));
        if ((role && DATA_ROLES.has(role)) || (to && to.name !== 'shared')) hit('dumb-smart', `shared UI imports ${role && DATA_ROLES.has(role) ? role : to.name} code`);
      }
      const toRole = fromRole && roleOf(graph.nodes.get(target));
      if (fromRole && toRole && ROLE_RANK[toRole] < ROLE_RANK[fromRole]) hit('leaf-up', `${fromRole} imports ${toRole}: leaves stay leaves`);
    }
    if (node.ui && (node.lines > rules.limits.kitLines || node.imports.length + node.external.size > rules.limits.kitImports)) {
      found.push({ rule: 'kit-size', file: node.path, note: `${node.lines} lines, ${node.imports.length + node.external.size} imports` });
    }
  }
  for (const group of cyclesOf(graph)) {
    if (only && !group.some((path) => only.has(path))) continue;
    const loop = loopOf(graph, group);
    found.push({ rule: 'cycle', file: loop[0], note: `${group.length} files: ${loop.join(' → ')}` });
  }
  const modules = new Map();
  for (const path of graph.nodes.keys()) {
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.';
    modules.set(dir, (modules.get(dir) ?? 0) + 1);
  }
  for (const [dir, count] of modules) {
    if (count <= rules.limits.folderModules) continue;
    if (only && ![...only].some((path) => path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes('/'))) continue;
    found.push({ rule: 'folder-size', file: dir, note: `${count} modules in one folder` });
  }
  return found;
};
