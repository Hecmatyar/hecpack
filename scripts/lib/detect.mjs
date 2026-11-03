// Reads a project without changing it: workspaces, technologies with their versions and evidence, the
// validation commands, the folders for the project map, the Claude setup the project already has and the
// rule documents it keeps for its agents (docs.mjs).

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { findDocs } from './docs.mjs';

const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', 'out', 'out-tsc', 'tmp', 'coverage', '.git', '.next', '.expo',
  '.turbo', '.nx', 'Pods', 'vendor', 'target', '__pycache__', '.venv', 'venv',
]);

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
};

const isDir = (path) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

const listDirs = (dir) =>
  isDir(dir)
    ? readdirSync(dir)
        .filter((name) => !name.startsWith('.') && !SKIP_DIRS.has(name) && isDir(join(dir, name)))
        .sort()
    : [];

const globToRegExp = (glob) =>
  new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);

// A path relative to `dir`; `*` matches within one segment ("ios/*.xcodeproj").
export const matchPath = (dir, pattern) => {
  const segments = pattern.split('/');
  let current = [dir];
  for (const segment of segments) {
    const next = [];
    for (const base of current) {
      if (!segment.includes('*')) {
        if (existsSync(join(base, segment))) next.push(join(base, segment));
        continue;
      }
      if (!isDir(base)) continue;
      const re = globToRegExp(segment);
      for (const name of readdirSync(base)) if (re.test(name)) next.push(join(base, name));
    }
    current = next;
  }
  return current;
};

const packageManager = (root) => {
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(root, 'bun.lockb')) || existsSync(join(root, 'bun.lock'))) return 'bun';
  if (existsSync(join(root, 'package-lock.json'))) return 'npm';
  return existsSync(join(root, 'package.json')) ? 'npm' : undefined;
};

const workspacePatterns = (root, pkg) => {
  const patterns = [];
  const fromPkg = Array.isArray(pkg?.workspaces) ? pkg.workspaces : pkg?.workspaces?.packages;
  if (fromPkg) patterns.push(...fromPkg);
  const pnpm = join(root, 'pnpm-workspace.yaml');
  if (existsSync(pnpm)) {
    for (const [, item] of readFileSync(pnpm, 'utf8').matchAll(/^\s*-\s*['"]?([^'"\n]+)['"]?\s*$/gm)) {
      patterns.push(item.trim());
    }
  }
  // Nx and Turborepo without declared workspaces keep projects in these folders by convention.
  if (!patterns.length && (existsSync(join(root, 'nx.json')) || existsSync(join(root, 'turbo.json')))) {
    patterns.push('apps/*', 'libs/*', 'packages/*');
  }
  return patterns.filter((pattern) => !pattern.startsWith('!'));
};

const isProject = (dir) =>
  ['package.json', 'project.json', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'Package.swift'].some(
    (file) => existsSync(join(dir, file)),
  );

export const findWorkspaces = (root, pkg) => {
  const dirs = new Set();
  for (const pattern of workspacePatterns(root, pkg)) {
    const clean = pattern.replace(/\/\*\*$/, '/*').replace(/\/$/, '');
    for (const dir of matchPath(root, clean)) {
      if (isDir(dir) && !SKIP_DIRS.has(basename(dir)) && isProject(dir)) dirs.add(relative(root, dir));
    }
  }
  return [...dirs].sort();
};

const depsOf = (pkg) => ({
  ...pkg?.peerDependencies,
  ...pkg?.optionalDependencies,
  ...pkg?.devDependencies,
  ...pkg?.dependencies,
});

const cleanVersion = (range) => String(range ?? '').replace(/^[~^>=<\s]+/, '') || undefined;

// The version actually installed wins over the range in package.json.
const installedVersion = (root, dirs, dep) => {
  for (const dir of dirs) {
    const pkg = readJson(join(root, dir, 'node_modules', dep, 'package.json'));
    if (pkg?.version) return pkg.version;
  }
  return undefined;
};

export const detectTechs = (root, workspaces, catalog) => {
  const dirs = ['', ...workspaces];
  const packages = dirs
    .map((dir) => ({ dir, pkg: readJson(join(root, dir, 'package.json')) }))
    .filter(({ pkg }) => pkg);
  const found = [];
  for (const tech of catalog.technologies) {
    const evidence = [];
    let version;
    for (const dep of tech.detect.deps ?? []) {
      for (const { dir, pkg } of packages) {
        const range = depsOf(pkg)[dep];
        if (range === undefined) continue;
        evidence.push(`${dep} in ${join(dir, 'package.json')}`);
        version ??= installedVersion(root, ['', dir], dep) ?? cleanVersion(range);
      }
    }
    for (const file of tech.detect.files ?? []) {
      for (const dir of dirs) {
        for (const hit of matchPath(join(root, dir), file)) evidence.push(relative(root, hit));
      }
    }
    if (tech.detect.appJsonKey) {
      for (const dir of dirs) {
        if (readJson(join(root, dir, 'app.json'))?.[tech.detect.appJsonKey]) {
          evidence.push(`"${tech.detect.appJsonKey}" in ${join(dir, 'app.json')}`);
        }
      }
    }
    if (evidence.length) {
      found.push({ ...tech, version, evidence: [...new Set(evidence)].slice(0, 4) });
    }
  }
  // A package.json alone says JavaScript; drop it when TypeScript is there.
  return found.some((tech) => tech.id === 'typescript') ? found.filter((tech) => tech.id !== 'javascript') : found;
};

// Nx infers targets from its plugins; these are the ones that give the checks we run.
const NX_PLUGIN_TARGETS = {
  '@nx/js/typescript': 'typecheck',
  '@nx/eslint/plugin': 'lint',
  '@nx/jest/plugin': 'test',
  '@nx/vite/plugin': 'test',
  '@nx/vitest': 'test',
  '@nx/playwright/plugin': 'e2e',
};

const CHECK_SCRIPTS = [
  ['typecheck', /^(typecheck|type-check|tsc|check-types|types)$/],
  ['lint', /^lint$/],
  ['test', /^test$/],
];

const run = (pm, script) => (pm === 'npm' ? `npm run ${script}` : `${pm} ${script}`);

export const detectValidation = (root, pkg, techs) => {
  const ids = new Set(techs.map((tech) => tech.id));
  const pm = packageManager(root) ?? 'npm';
  const commands = [];
  const scripts = pkg?.scripts ?? {};
  if (ids.has('nx')) {
    const nx = readJson(join(root, 'nx.json')) ?? {};
    const targets = new Set();
    for (const plugin of nx.plugins ?? []) {
      const name = typeof plugin === 'string' ? plugin : plugin.plugin;
      const options = typeof plugin === 'string' ? {} : plugin.options ?? {};
      const target = NX_PLUGIN_TARGETS[name];
      if (!target || target === 'e2e') continue;
      targets.add(options[`${target}TargetName`] ?? options.targetName ?? target);
    }
    for (const target of Object.keys(nx.targetDefaults ?? {})) {
      if (['typecheck', 'lint', 'test'].includes(target)) targets.add(target);
    }
    if (targets.size) {
      commands.push({
        check: [...targets].join(' + '),
        command: `npx nx run-many -t ${[...targets].join(' ')}`,
        scoped: `npx nx run-many -t ${[...targets].join(' ')} -p <project>`,
        source: 'nx.json plugins',
      });
    }
  } else if (ids.has('turborepo')) {
    const turbo = readJson(join(root, 'turbo.json')) ?? {};
    const tasks = Object.keys(turbo.tasks ?? turbo.pipeline ?? {}).filter((task) =>
      ['typecheck', 'check-types', 'lint', 'test'].includes(task),
    );
    if (tasks.length) {
      commands.push({ check: tasks.join(' + '), command: `npx turbo run ${tasks.join(' ')}`, source: 'turbo.json' });
    }
  }
  if (!commands.length) {
    for (const [check, re] of CHECK_SCRIPTS) {
      const script = Object.keys(scripts).find((name) => re.test(name));
      if (script) commands.push({ check, command: run(pm, script), source: `package.json scripts.${script}` });
    }
    if (ids.has('typescript') && !commands.some((item) => item.check === 'typecheck')) {
      commands.unshift({ check: 'typecheck', command: 'npx tsc --noEmit', source: 'tsconfig.json (no script)' });
    }
  }
  if (ids.has('python')) {
    const pyproject = existsSync(join(root, 'pyproject.toml')) ? readFileSync(join(root, 'pyproject.toml'), 'utf8') : '';
    if (/\bruff\b/.test(pyproject)) commands.push({ check: 'lint', command: 'ruff check .', source: 'pyproject.toml' });
    if (/\bmypy\b/.test(pyproject)) commands.push({ check: 'typecheck', command: 'mypy .', source: 'pyproject.toml' });
    if (/\bpytest\b/.test(pyproject)) commands.push({ check: 'test', command: 'pytest', source: 'pyproject.toml' });
  }
  if (ids.has('go')) commands.push({ check: 'vet + test', command: 'go vet ./... && go test ./...', source: 'go.mod' });
  if (ids.has('rust')) commands.push({ check: 'check + test', command: 'cargo clippy && cargo test', source: 'Cargo.toml' });
  return commands;
};

// The folders a project map lists: each workspace (or the root) with its source folders one level down.
export const detectFolders = (root, workspaces, pkg) => {
  const units = workspaces.length ? workspaces : [''];
  return units.map((dir) => {
    const own = readJson(join(root, dir, 'package.json'));
    const src = ['src', 'app', 'lib'].find((name) => isDir(join(root, dir, name)));
    return {
      path: dir || '.',
      name: own?.name ?? (dir ? basename(dir) : pkg?.name ?? basename(root)),
      description: own?.description ?? '',
      children: src ? listDirs(join(root, dir, src)).slice(0, 20).map((name) => join(dir, src, name)) : listDirs(join(root, dir)).slice(0, 20).map((name) => join(dir, name)),
    };
  });
};

const names = (dir, filter = () => true) =>
  isDir(dir) ? readdirSync(dir).filter((name) => !name.startsWith('.') && filter(name)).sort() : [];

// The Claude setup the project already has. hecpack never changes it; the preview names what overlaps.
export const detectClaude = (root) => {
  const claudeMd = ['CLAUDE.md', '.claude/CLAUDE.md'].filter((file) => existsSync(join(root, file)));
  const settings = ['.claude/settings.json', '.claude/settings.local.json']
    .map((file) => ({ file, json: readJson(join(root, file)) }))
    .filter(({ json }) => json);
  const hookEvents = [...new Set(settings.flatMap(({ json }) => Object.keys(json.hooks ?? {})))];
  const enabledPlugins = Object.fromEntries(
    settings.flatMap(({ json }) => Object.entries(json.enabledPlugins ?? {})),
  );
  return {
    claudeMd,
    agents: names(join(root, '.claude/agents'), (name) => name.endsWith('.md')).map((name) => name.slice(0, -3)),
    skills: names(join(root, '.claude/skills')),
    rules: names(join(root, '.claude/rules')),
    hookEvents,
    enabledPlugins,
    mcp: Object.keys(readJson(join(root, '.mcp.json'))?.mcpServers ?? {}),
    hecpack: existsSync(join(root, '.claude/hecpack/config.json')),
  };
};

export const detect = (root, catalog) => {
  const pkg = readJson(join(root, 'package.json'));
  const workspaces = findWorkspaces(root, pkg);
  const techs = detectTechs(root, workspaces, catalog);
  return {
    root,
    name: pkg?.name ?? basename(root),
    packageManager: packageManager(root),
    workspaces,
    techs,
    validation: detectValidation(root, pkg, techs),
    folders: detectFolders(root, workspaces, pkg),
    claude: detectClaude(root),
    docs: findDocs(root, workspaces),
  };
};
