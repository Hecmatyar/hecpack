// The layout of a project as its own files describe it, read again on every run so it never goes stale:
// the packages (the root and its workspaces) with their entry files, the import aliases (tsconfig or
// jsconfig `paths`, workspace package names), the platform suffixes the bundler resolves (React Native)
// and the folders whose file paths are routes. /hecpack:move works from it and /init writes it into
// stack.md; `layout` in .claude/hecpack/config.json overrides what detection gets wrong.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';

export const SCRIPT_FILE = /\.[cm]?[jt]sx?$/;
export const RN_PLATFORMS = ['ios', 'android', 'native', 'web'];

const BUILD_DIR = /(?:^|\/)(?:dist|build|out|out-tsc|lib-cjs|lib-esm|node_modules)\//;

// Dependencies that make some folders file-based routes: a file there is a URL, so moving it changes one.
const ROUTE_DIRS = [
  ['next', ['app', 'src/app', 'pages', 'src/pages']],
  ['expo-router', ['app', 'src/app']],
  ['@remix-run/react', ['app/routes']],
  ['@react-router/dev', ['app/routes']],
  ['@tanstack/router-plugin', ['src/routes']],
  ['@sveltejs/kit', ['src/routes']],
  ['astro', ['src/pages']],
  ['nuxt', ['pages', 'app/pages']],
];

export const within = (path, dir) => dir === '.' || path === dir || path.startsWith(`${dir}/`);

const isDir = (path) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

// JSON with comments and trailing commas, as tsconfig and jsconfig allow.
export const parseJsonc = (text) => {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      let end = i + 1;
      while (end < text.length && text[end] !== '"') end += text[end] === '\\' ? 2 : 1;
      out += text.slice(i, end + 1);
      i = end;
    } else if (char === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      out += '\n';
    } else if (char === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 1;
    } else if (char === ',' && /^\s*[}\]]/.test(text.slice(i + 1, i + 200).replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ''))) {
      // A trailing comma: dropped.
    } else {
      out += char;
    }
  }
  return JSON.parse(out);
};

const readJsonc = (file) => {
  try {
    return parseJsonc(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
};

const repoPath = (dir, path) => {
  const joined = posix.normalize(posix.join(dir, path));
  return joined.startsWith('../') || posix.isAbsolute(path) ? null : joined.replace(/\/$/, '');
};

// compilerOptions.paths of a tsconfig after its relative `extends`: targets resolve from baseUrl, else
// from the folder of the config that set paths. Presets from packages (expo/tsconfig.base) set no
// project paths and are not followed.
const readPaths = (root, file, seen = new Set()) => {
  if (seen.has(file)) return null;
  seen.add(file);
  const config = readJsonc(join(root, file));
  if (!config) return null;
  const dir = posix.dirname(file);
  let result = { paths: undefined, pathsDir: undefined, baseUrl: undefined };
  for (const parent of [config.extends ?? []].flat()) {
    if (typeof parent !== 'string' || !/^\.\.?\//.test(parent)) continue;
    const path = repoPath(dir, parent.endsWith('.json') ? parent : `${parent}.json`);
    const inherited = path && readPaths(root, path, seen);
    if (!inherited) continue;
    result = {
      paths: inherited.paths ?? result.paths,
      pathsDir: inherited.paths ? inherited.pathsDir : result.pathsDir,
      baseUrl: inherited.baseUrl ?? result.baseUrl,
    };
  }
  const options = config.compilerOptions ?? {};
  if (typeof options.baseUrl === 'string') result.baseUrl = repoPath(dir, options.baseUrl) ?? result.baseUrl;
  if (options.paths && typeof options.paths === 'object') {
    result.paths = options.paths;
    result.pathsDir = dir;
  }
  return { ...result, references: referencesOf(config, dir) };
};

const referencesOf = (config, dir) =>
  (config.references ?? [])
    .map((reference) => typeof reference?.path === 'string' && repoPath(dir, reference.path))
    .filter(Boolean)
    .map((path) => (path.endsWith('.json') ? path : `${path}/tsconfig.json`));

const toAlias = (pattern, targets, scope, implicit = false) => {
  const star = pattern.indexOf('*');
  return {
    pattern,
    wildcard: star >= 0,
    prefix: star >= 0 ? pattern.slice(0, star) : pattern,
    suffix: star >= 0 ? pattern.slice(star + 1) : '',
    targets,
    scope,
    implicit,
  };
};

// The aliases a package's tsconfig and jsconfig files declare (the root also its tsconfig.base.json),
// with the configs they reference (a Vite app keeps its paths in tsconfig.app.json).
const CONFIG_NAMES = ['tsconfig.json', 'jsconfig.json'];

const configAliases = (root, dir) => {
  const names = [...CONFIG_NAMES, ...(dir === '.' ? ['tsconfig.base.json'] : [])];
  const queue = names.map((name) => (dir === '.' ? name : `${dir}/${name}`)).filter((file) => existsSync(join(root, file)));
  const seen = new Set();
  const aliases = [];
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    const found = readPaths(root, file);
    if (!found) continue;
    queue.push(...found.references.filter((path) => existsSync(join(root, path))));
    if (!found.paths) continue;
    const base = found.baseUrl ?? found.pathsDir;
    for (const [pattern, targets] of Object.entries(found.paths)) {
      const resolved = [targets].flat().filter((item) => typeof item === 'string').map((item) => repoPath(base, item)).filter(Boolean);
      if (resolved.length && !aliases.some((alias) => alias.pattern === pattern)) aliases.push(toAlias(pattern, resolved, dir));
    }
  }
  return aliases;
};

// Every string a package.json `exports` value names, conditions included, in order.
const exportStrings = (value) =>
  typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(exportStrings) : [];

const dotExport = (exports) => {
  if (typeof exports === 'string' || Array.isArray(exports)) return exports;
  if (!exports || typeof exports !== 'object') return undefined;
  return Object.keys(exports).some((key) => key.startsWith('.')) ? exports['.'] : exports;
};

// The source file a package's name resolves to, when its manifest points into the sources (a
// workspace built by its consumers); null when it points at build output.
const entryOf = (root, dir, pkg) => {
  const candidates = [...exportStrings(dotExport(pkg.exports)), pkg.source, pkg.types, pkg.typings, pkg.module, pkg.main];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const path = repoPath(dir, candidate);
    if (path && SCRIPT_FILE.test(path) && !path.endsWith('.d.ts') && !BUILD_DIR.test(`${path}`) && existsSync(join(root, path))) {
      return path;
    }
  }
  return null;
};

const readPackage = (root, dir) => {
  const pkg = readJsonc(join(root, dir, 'package.json')) ?? {};
  const project = readJsonc(join(root, dir, 'project.json')) ?? {};
  const deps = new Set(
    Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies, ...pkg.optionalDependencies }),
  );
  return {
    dir,
    name: typeof pkg.name === 'string' ? pkg.name : null,
    project: typeof project.name === 'string' ? project.name : null,
    entry: dir === '.' ? null : entryOf(root, dir, pkg),
    exports: pkg.exports !== undefined,
    deps,
  };
};

// Workspace package names as aliases: the name to its source entry, and `<name>/*` to its folder when
// the manifest has no `exports` map (a deep import the project already uses, never one move adds).
const workspaceAliases = (packages) =>
  packages
    .filter((item) => item.dir !== '.' && item.name)
    .flatMap((item) => [
      ...(item.entry ? [toAlias(item.name, [item.entry], '.', true)] : []),
      ...(item.exports ? [] : [toAlias(`${item.name}/*`, [`${item.dir}/*`], '.', true)]),
    ]);

const routeDirs = (root, item) =>
  ROUTE_DIRS.filter(([dep]) => item.deps.has(dep))
    .flatMap(([, dirs]) => dirs)
    .map((path) => (item.dir === '.' ? path : `${item.dir}/${path}`))
    .filter((path, i, all) => all.indexOf(path) === i && isDir(join(root, path)));

export const readOverrides = (root) => readJsonc(join(root, '.claude/hecpack/config.json'))?.layout ?? {};

// workspaces: the folders detect.findWorkspaces lists, relative to the root.
export const readLayout = (root, workspaces = [], overrides = readOverrides(root)) => {
  const dirs = ['.', ...workspaces.map((dir) => dir.split('\\').join('/'))];
  const packages = dirs.map((dir) => readPackage(root, dir));
  const aliases = [...dirs.flatMap((dir) => configAliases(root, dir)), ...workspaceAliases(packages)];
  // A package with a tsconfig or jsconfig of its own sees only the paths that config has (inherited ones
  // included); one without sees the root's.
  const configured = dirs.filter((dir) => dir !== '.' && CONFIG_NAMES.some((name) => existsSync(join(root, dir, name))));
  const native = packages.some((item) => item.deps.has('react-native') || item.deps.has('expo'));
  return createLayout({
    packages,
    aliases,
    configured,
    platforms: Array.isArray(overrides.platforms) ? overrides.platforms : native ? RN_PLATFORMS : [],
    routes: Array.isArray(overrides.routes) ? overrides.routes : packages.flatMap((item) => routeDirs(root, item)),
  });
};

// The layout's data with the lookups move and the checks need.
export const createLayout = ({ packages, aliases, configured = [], platforms, routes }) => {
  const byDepth = [...packages].filter((item) => item.dir !== '.').sort((a, b) => b.dir.length - a.dir.length);
  const projectOf = (path) => byDepth.find((item) => within(path, item.dir))?.dir ?? '.';

  const scoped = new Map();
  // The aliases a file can use: its package's config paths (the root's when it has no config of its
  // own), then the workspace package names.
  const aliasesFor = (path) => {
    const project = projectOf(path);
    if (!scoped.has(project)) {
      const scope = configured.includes(project) ? project : '.';
      const own = aliases.filter((alias) => !alias.implicit && alias.scope === scope);
      const names = aliases.filter((alias) => alias.implicit && !own.some((item) => item.pattern === alias.pattern));
      scoped.set(project, [...own, ...names]);
    }
    return scoped.get(project);
  };

  // Where an alias specifier points from a file, as TypeScript matches it: an exact pattern, else the
  // wildcard pattern with the longest prefix; the first target `exists` accepts, else the first.
  const resolveAlias = (importer, specifier, exists = () => false) => {
    const list = aliasesFor(importer);
    const exact = list.find((alias) => !alias.wildcard && alias.pattern === specifier);
    if (exact) return { alias: exact, target: exact.targets[0], exact: true };
    let best = null;
    for (const alias of list) {
      if (
        alias.wildcard &&
        alias.prefix &&
        specifier.length >= alias.prefix.length + alias.suffix.length &&
        specifier.startsWith(alias.prefix) &&
        specifier.endsWith(alias.suffix) &&
        (!best || alias.prefix.length > best.prefix.length)
      ) {
        best = alias;
      }
    }
    if (!best) return null;
    const star = specifier.slice(best.prefix.length, specifier.length - best.suffix.length);
    const targets = best.targets.map((target) => target.replace('*', star));
    return { alias: best, target: targets.find(exists) ?? targets[0], exact: false };
  };

  // A wildcard alias specifier that points from importer to target: the preferred alias first, then
  // the most specific mapping. Implicit aliases (workspace deep imports) only as the preferred one.
  const expressAlias = (importer, target, preferred = null) => {
    const list = aliasesFor(importer).filter((alias) => alias.wildcard && (!alias.implicit || alias === preferred));
    const options = [];
    for (const alias of list) {
      for (const pattern of alias.targets) {
        const star = pattern.indexOf('*');
        if (star < 0) continue;
        const [head, tail] = [pattern.slice(0, star), pattern.slice(star + 1)];
        if (target.length <= head.length + tail.length || !target.startsWith(head) || !target.endsWith(tail)) continue;
        const specifier = alias.prefix + target.slice(head.length, target.length - tail.length) + alias.suffix;
        if (resolveAlias(importer, specifier)?.alias === alias) options.push({ alias, specifier, weight: head.length });
      }
    }
    options.sort((a, b) => (b.alias === preferred) - (a.alias === preferred) || b.weight - a.weight);
    return options[0]?.specifier ?? null;
  };

  // Workspace package → { alias, index }: the exact alias that names its entry file (tsconfig first).
  const libs = new Map();
  for (const alias of aliases) {
    if (alias.wildcard || alias.targets.length !== 1) continue;
    const project = projectOf(alias.targets[0]);
    if (project !== '.' && !libs.has(project)) libs.set(project, { alias: alias.pattern, index: alias.targets[0] });
  }
  // Entry file → the alias or package that names it: such a file is not moved.
  const entries = new Map();
  for (const alias of aliases) if (!alias.wildcard) for (const target of alias.targets) entries.set(target, alias.pattern);
  for (const item of packages) if (item.entry && !entries.has(item.entry)) entries.set(item.entry, item.name ?? item.dir);

  return { packages, aliases, platforms, routes, projectOf, aliasesFor, resolveAlias, expressAlias, libs, entries };
};

// The layout as the scan JSON shows it to the skills.
export const summarizeLayout = (layout) => ({
  packages: layout.packages.filter((item) => item.dir !== '.').map((item) => ({ dir: item.dir, name: item.name, entry: item.entry })),
  aliases: layout.aliases.filter((alias) => !alias.implicit).map((alias) => `${alias.pattern} → ${alias.targets.join(' | ')}`),
  platforms: layout.platforms,
  routes: layout.routes,
});

// The Layout section of stack.md: what move and the checks read, in a few lines.
export const describeLayout = (layout) => {
  const code = (text) => `\`${text}\``;
  const list = (items, limit) => (items.length > limit ? [...items.slice(0, limit), `${items.length - limit} more`] : items).join(', ');
  const packages = layout.packages
    .filter((item) => item.dir !== '.')
    .map((item) => `${code(item.dir)}${item.name ? ` (${item.name}${item.entry ? `, entry ${code(item.entry)}` : ''})` : ''}`);
  const aliases = layout.aliases
    .filter((alias) => !alias.implicit)
    .map((alias) => `${code(alias.pattern)} → ${alias.targets.map(code).join(' | ')}${alias.scope === '.' ? '' : ` in ${code(alias.scope)}`}`);
  const lines = [
    '## Layout',
    '',
    'How hecpack reads this project, detected again on every run; a wrong value is fixed under `layout` in `.claude/hecpack/config.json` (`platforms`, `routes`).',
    '',
    `- Packages: ${packages.length ? list(packages, 20) : 'one, the root'}`,
    `- Aliases: ${aliases.length ? list(aliases, 15) : 'none; imports are relative or by package name'}`,
  ];
  if (layout.platforms.length) {
    lines.push(`- Platform suffixes: ${layout.platforms.map((name) => code(`.${name}`)).join(', ')}; the bundler picks the file per platform, so a group (\`Foo.tsx\`, \`Foo.ios.tsx\`, \`Foo.test.tsx\`) moves together`);
  }
  if (layout.routes.length) {
    lines.push(`- Route folders: ${list(layout.routes.map(code), 10)}; a file path there is a URL, so moving it needs the user's yes`);
  }
  lines.push('- Moving or renaming files: `/hecpack:move` rewrites every import of the moved files, across packages too');
  return lines;
};
