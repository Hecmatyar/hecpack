// The architecture audit as a short summary the model reads instead of the code: rule breaks by kind,
// import loops, two-way dependencies between units and packages, hubs, files that pull in everything,
// oversized files and folders, files nothing imports, two tools doing one job, and the 10–15 files worth
// reading. Every list is cut to its top entries with the full count beside it.

import { within } from '../layout.mjs';
import { check, compileRules, cyclesOf, loopOf, SEVERITY } from './rules.mjs';

// Libraries that do one job: two of them in use is a choice the project never finished.
const SAME_JOB = {
  state: ['redux', '@reduxjs/toolkit', 'zustand', 'mobx', 'jotai', 'recoil', 'valtio', '@legendapp/state'],
  'data fetching': ['axios', 'ky', 'swr', '@tanstack/react-query', '@apollo/client', 'urql', 'ofetch'],
  dates: ['moment', 'dayjs', 'date-fns', 'luxon'],
  styling: ['styled-components', '@emotion/styled', '@emotion/react', 'nativewind', 'twrnc', '@vanilla-extract/css', 'tamagui'],
  forms: ['formik', 'react-hook-form', 'final-form', '@tanstack/react-form'],
  validation: ['yup', 'zod', 'joi', 'valibot', 'superstruct'],
  utilities: ['lodash', 'lodash-es', 'ramda', 'underscore'],
};

const INDEX = /(?:^|\/)index\.[cm]?[jt]sx?$/;
// Folders of data rather than code: big by nature.
const DATA_DIR = /(?:^|\/)(?:locales?|i18n|translations|fixtures|mocks?|seeds?|seed-[\w-]+|generated|__generated__)\//;

const top = (items, limit) => ({ count: items.length, top: items.slice(0, limit) });

const where = (item) => (item.line ? `${item.file}:${item.line}` : item.file);

// rules: accepted (architecture.md) or inferred; source says which. → the summary object.
export const audit = ({ graph, layout, rules, source, limit = 10 }) => {
  const compiled = compileRules(rules);
  const nodes = [...graph.nodes.values()];
  const edges = nodes.reduce((sum, node) => sum + node.imports.length, 0);

  const violations = {};
  for (const item of check(graph, rules)) {
    if (item.rule === 'cycle') continue;
    (violations[item.rule] ??= []).push(item.target ? `${where(item)} → ${item.target} (${item.note})` : `${where(item)} (${item.note})`);
  }

  const cycles = cyclesOf(graph);

  // Unit and package pairs that import each other: the smaller direction is the likely wrong one. An
  // index re-exports by design, and the files at a package's top are its shared base: neither counts.
  const root = (node) => node.unit === node.project || node.unit === '.' || /(?:^|\/)src$/.test(node.unit);
  const pairs = (key) => {
    const counts = new Map();
    for (const node of nodes) {
      if (INDEX.test(node.path) || (key === 'unit' && root(node))) continue;
      for (const { target, line } of node.imports) {
        const other = graph.nodes.get(target);
        const a = node[key];
        const b = other[key];
        if (a === b || (key === 'unit' && root(other))) continue;
        const id = `${a}\u0000${b}`;
        const entry = counts.get(id) ?? { count: 0, sample: `${node.path}:${line} → ${target}` };
        entry.count += 1;
        counts.set(id, entry);
      }
    }
    const out = [];
    for (const [id, forward] of counts) {
      const [a, b] = id.split('\u0000');
      const back = counts.get(`${b}\u0000${a}`);
      if (!back || a > b) continue;
      const [major, minor] = forward.count >= back.count ? [[a, b, forward], [b, a, back]] : [[b, a, back], [a, b, forward]];
      out.push({ main: `${major[0]} → ${major[1]} (${major[2].count})`, against: `${minor[0]} → ${minor[1]} (${minor[2].count})`, sample: minor[2].sample, weight: minor[2].count });
    }
    return out.sort((x, y) => y.weight - x.weight).map(({ weight, ...rest }) => rest);
  };

  const hubs = nodes
    .filter((node) => node.dependents.size >= 5 && !INDEX.test(node.path))
    .sort((a, b) => b.dependents.size * Math.max(1, b.imports.length) - a.dependents.size * Math.max(1, a.imports.length))
    .map((node) => `${node.path} (${node.dependents.size} importers, imports ${node.imports.length})`);
  const pulls = nodes
    .filter((node) => node.imports.length >= 15 && !INDEX.test(node.path))
    .sort((a, b) => b.imports.length - a.imports.length)
    .map((node) => `${node.path} (${node.imports.length} project imports)`);
  const bigFiles = nodes
    .filter((node) => !node.ui && node.lines >= 400 && !DATA_DIR.test(node.path))
    .sort((a, b) => b.lines - a.lines)
    .map((node) => `${node.path} (${node.lines} lines)`);

  // Nothing imports it, and it sits inside a src folder (scripts and tools outside src are entry points),
  // below its top: no entry, route, index, config or platform file (the bundler picks those).
  const unused = nodes
    .filter(
      (node) =>
        !node.dependents.size &&
        node.inner &&
        /(?:^|\/)src\//.test(node.path) &&
        !INDEX.test(node.path) &&
        !/\.config\.[cm]?[jt]s$/.test(node.path) &&
        !layout.platforms.some((platform) => new RegExp(`\\.${platform}\\.[cm]?[jt]sx?$`).test(node.path)) &&
        !layout.entries.has(node.path) &&
        !layout.routes.some((dir) => within(node.path, dir)),
    )
    .map((node) => node.path)
    .sort();

  const external = new Map();
  for (const node of nodes) for (const name of node.external) external.set(name, (external.get(name) ?? 0) + 1);
  const twoTools = Object.entries(SAME_JOB)
    .map(([job, names]) => ({ job, used: names.filter((name) => external.has(name)).map((name) => `${name} (${external.get(name)} files)`) }))
    .filter(({ used }) => used.length >= 2);

  // What to read: the worst offenders and the files the problems meet in, 15 at most.
  const readFirst = [];
  const pick = (path) => {
    if (path && graph.nodes.has(path) && !readFirst.includes(path) && readFirst.length < 15) readFirst.push(path);
  };
  const firstFile = (line) => line.split(/[: ]/)[0];
  for (const rule of ['layer-up', 'dumb-smart', 'sideways', 'leaf-up']) for (const line of (violations[rule] ?? []).slice(0, 2)) pick(firstFile(line));
  for (const group of cycles.slice(0, 2)) pick(loopOf(graph, group)[1]);
  for (const pair of [...pairs('project'), ...pairs('unit')].slice(0, 3)) pick(firstFile(pair.sample));
  for (const line of hubs.slice(0, 3)) pick(firstFile(line));
  for (const line of pulls.slice(0, 2)) pick(firstFile(line));
  for (const line of (violations['kit-size'] ?? []).slice(0, 2)) pick(firstFile(line));

  return {
    rules: source,
    project: { files: nodes.length, imports: edges, packages: layout.packages.length - 1, units: new Set(nodes.map((node) => node.unit)).size },
    layers: compiled.layers.map((layer) => `${layer.name}${layer.isolated ? ' (slices apart)' : ''}: ${layer.paths.join(', ')}`),
    sharedUi: compiled.sharedUi,
    breaks: Object.fromEntries(
      Object.entries(violations)
        .sort((a, b) => (SEVERITY[a[0]] === SEVERITY[b[0]] ? b[1].length - a[1].length : SEVERITY[a[0]] === 'error' ? -1 : 1))
        .map(([rule, lines]) => [rule, top(lines, limit)]),
    ),
    cycles: top(cycles.map((group) => `${group.length} files: ${loopOf(graph, group).slice(0, 8).join(' → ')}`), 5),
    twoWayPackages: top(pairs('project'), limit),
    twoWayUnits: top(pairs('unit'), limit),
    hubs: top(hubs, limit),
    pullsEverything: top(pulls, limit),
    bigFiles: top(bigFiles, limit),
    unused: top(unused, limit),
    twoTools,
    readFirst,
  };
};
