// Project metrics for a before/after comparison: the shape of the code (files, lines, tests, big files,
// TODOs) and the rhythm of the work in git over a window (commits, lines, fix share, reverts, churn).
// Read-only; the snapshot is a plain object the caller stores.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', 'out', 'out-tsc', 'tmp', 'coverage', '.git', '.next', '.expo', '.turbo', '.nx',
  'Pods', 'vendor', 'target', '__pycache__', '.venv', 'venv', '.idea', '.vscode', 'DerivedData',
]);
const SOURCE_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.vue', '.svelte', '.py', '.go', '.rs', '.swift', '.kt',
  '.java', '.rb', '.php', '.cs', '.c', '.cc', '.cpp', '.h', '.hpp', '.m', '.mm', '.scala', '.dart', '.ex', '.exs',
]);
const TEST_FILE = /(\.(test|spec)\.[^.]+$|(^|\/)(__tests__|tests?|spec|e2e)\/|_test\.(go|py|rs)$|Tests?\.swift$)/;
const BIG_FILE = 300;
const LOCK_FILES = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock|Podfile\.lock|go\.sum)$/;

const git = (root, args) => {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return result.status === 0 ? result.stdout : undefined;
};

// Files to measure: what git tracks when the project is a repo (its .gitignore decides), else a walk.
const listFiles = (root) => {
  const tracked = git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  if (tracked !== undefined) {
    return tracked.split('\0').filter((path) => path && !path.split('/').some((part) => SKIP_DIRS.has(part)) && existsSync(join(root, path)));
  }
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (SKIP_DIRS.has(name)) continue;
      const path = join(dir, name);
      const stat = statSync(path);
      if (stat.isDirectory()) walk(path);
      else out.push(relative(root, path));
    }
  };
  walk(root);
  return out;
};

const median = (values) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

export const codeMetrics = (root) => {
  const files = listFiles(root);
  const byExt = {};
  const lineCounts = [];
  const big = [];
  let sourceFiles = 0;
  let sourceLines = 0;
  let testFiles = 0;
  let testLines = 0;
  let todos = 0;
  for (const path of files) {
    const ext = extname(path).toLowerCase();
    if (!SOURCE_EXT.has(ext) || LOCK_FILES.test(path)) continue;
    let text;
    try {
      text = readFileSync(join(root, path), 'utf8');
    } catch {
      continue;
    }
    const lines = text.split('\n').length;
    byExt[ext] = { files: (byExt[ext]?.files ?? 0) + 1, lines: (byExt[ext]?.lines ?? 0) + lines };
    todos += (text.match(/\b(TODO|FIXME|HACK|XXX)\b/g) ?? []).length;
    if (TEST_FILE.test(path)) {
      testFiles += 1;
      testLines += lines;
    } else {
      sourceFiles += 1;
      sourceLines += lines;
      lineCounts.push(lines);
      if (lines > BIG_FILE) big.push({ path, lines });
    }
  }
  big.sort((a, b) => b.lines - a.lines);
  return {
    filesTotal: files.length,
    sourceFiles,
    sourceLines,
    testFiles,
    testLines,
    testRatio: sourceFiles ? Number((testFiles / sourceFiles).toFixed(2)) : 0,
    medianFileLines: median(lineCounts),
    bigFiles: big.length,
    largest: big.slice(0, 5),
    todos,
    byExtension: Object.fromEntries(Object.entries(byExt).sort((a, b) => b[1].lines - a[1].lines)),
  };
};

const FIX_WORDS = /\b(fix|fixes|fixed|bug|hotfix|regression|исправ|фикс|баг)\b/i;

export const gitMetrics = (root, days) => {
  if (git(root, ['rev-parse', '--git-dir']) === undefined) return undefined;
  const since = `--since=${days} days ago`;
  const log = git(root, ['log', since, '--no-merges', '--numstat', '--format=%x01%H%x02%an%x02%s']);
  if (log === undefined) return undefined;
  const commits = [];
  let current;
  const churn = {};
  for (const line of log.split('\n')) {
    if (line.startsWith('\u0001')) {
      const [hash, author, subject] = line.slice(1).split('\u0002');
      current = { hash, author, subject, added: 0, removed: 0, files: 0 };
      commits.push(current);
    } else if (current && /^\d+\t|^-\t/.test(line)) {
      const [added, removed, path] = line.split('\t');
      if (LOCK_FILES.test(path)) continue;
      current.files += 1;
      current.added += Number(added) || 0;
      current.removed += Number(removed) || 0;
      churn[path] = (churn[path] ?? 0) + 1;
    }
  }
  const total = commits.length;
  const sum = (key) => commits.reduce((acc, commit) => acc + commit[key], 0);
  const hot = Object.entries(churn).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([path, changes]) => ({ path, changes }));
  const firstCommit = git(root, ['log', '--reverse', '--format=%cs', '--max-count=1'])?.trim();
  return {
    days,
    commits: total,
    authors: new Set(commits.map((commit) => commit.author)).size,
    commitsPerWeek: Number(((total / days) * 7).toFixed(1)),
    linesAdded: sum('added'),
    linesRemoved: sum('removed'),
    filesPerCommit: total ? Number((sum('files') / total).toFixed(1)) : 0,
    linesPerCommit: total ? Math.round((sum('added') + sum('removed')) / total) : 0,
    fixShare: total ? Number((commits.filter((commit) => FIX_WORDS.test(commit.subject)).length / total).toFixed(2)) : 0,
    reverts: commits.filter((commit) => /^revert\b/i.test(commit.subject)).length,
    hotFiles: hot,
    firstCommit,
  };
};

export const claudeMetrics = (root) => {
  const config = join(root, '.claude/hecpack/config.json');
  let hecpack;
  try {
    hecpack = JSON.parse(readFileSync(config, 'utf8')).level;
  } catch {
    hecpack = undefined;
  }
  const count = (dir) => (existsSync(join(root, dir)) ? readdirSync(join(root, dir)).length : 0);
  return {
    hecpackLevel: hecpack,
    claudeMd: ['CLAUDE.md', '.claude/CLAUDE.md'].filter((file) => existsSync(join(root, file))),
    agents: count('.claude/agents'),
    skills: count('.claude/skills'),
    rules: count('.claude/rules'),
  };
};

export const snapshot = ({ root, days = 30, date = new Date() }) => ({
  takenAt: date.toISOString(),
  root,
  code: codeMetrics(root),
  git: gitMetrics(root, days),
  claude: claudeMetrics(root),
});

// Rows for a before/after table: label, the two values and the change, for the numbers worth watching.
const ROWS = [
  ['Source files', 'code.sourceFiles'],
  ['Source lines', 'code.sourceLines'],
  ['Test files', 'code.testFiles'],
  ['Tests per source file', 'code.testRatio'],
  ['Median file length', 'code.medianFileLines'],
  ['Files over 300 lines', 'code.bigFiles'],
  ['TODO / FIXME', 'code.todos'],
  ['Commits in the window', 'git.commits'],
  ['Commits per week', 'git.commitsPerWeek'],
  ['Lines per commit', 'git.linesPerCommit'],
  ['Files per commit', 'git.filesPerCommit'],
  ['Fix commits share', 'git.fixShare'],
  ['Reverts', 'git.reverts'],
];

const pick = (object, path) => path.split('.').reduce((value, key) => value?.[key], object);

export const compare = (before, after) =>
  ROWS.map(([label, path]) => {
    const a = pick(before, path);
    const b = pick(after, path);
    const delta = typeof a === 'number' && typeof b === 'number' ? Number((b - a).toFixed(2)) : undefined;
    return { label, path, before: a, after: b, delta };
  }).filter((row) => row.before !== undefined || row.after !== undefined);

const fmt = (value) => (value === undefined ? '—' : String(value));

export const compareTable = (before, after) => {
  const rows = compare(before, after);
  const lines = [
    `| Metric | ${before.takenAt.slice(0, 10)} | ${after.takenAt.slice(0, 10)} | Change |`,
    '| --- | --- | --- | --- |',
  ];
  for (const row of rows) {
    const delta = row.delta === undefined ? '' : row.delta > 0 ? `+${row.delta}` : String(row.delta);
    lines.push(`| ${row.label} | ${fmt(row.before)} | ${fmt(row.after)} | ${delta} |`);
  }
  return lines.join('\n');
};

export const snapshotText = (snap) => {
  const { code, git: g, claude } = snap;
  const lines = [
    `Metrics of ${snap.root} on ${snap.takenAt.slice(0, 10)}.`,
    `Code: ${code.sourceFiles} source files, ${code.sourceLines} lines (median ${code.medianFileLines} per file, ${code.bigFiles} over ${BIG_FILE}); ${code.testFiles} test files (${code.testRatio} per source file); ${code.todos} TODO/FIXME.`,
  ];
  if (g) {
    lines.push(
      `Git, last ${g.days} days: ${g.commits} commits by ${g.authors} author${g.authors === 1 ? '' : 's'} (${g.commitsPerWeek} a week), +${g.linesAdded}/-${g.linesRemoved} lines, ${g.linesPerCommit} lines and ${g.filesPerCommit} files per commit, fix share ${g.fixShare}, ${g.reverts} reverts.`,
    );
    if (g.hotFiles.length) lines.push(`Most changed: ${g.hotFiles.map((item) => `${item.path} (${item.changes})`).join(', ')}.`);
  } else lines.push('Git: not a repository, no history metrics.');
  lines.push(`Claude setup: ${claude.hecpackLevel ? `hecpack ${claude.hecpackLevel}` : 'no hecpack'}, ${claude.claudeMd.length ? claude.claudeMd.join(', ') : 'no CLAUDE.md'}, ${claude.agents} agents, ${claude.skills} skills, ${claude.rules} rule files.`);
  return lines.join('\n');
};
