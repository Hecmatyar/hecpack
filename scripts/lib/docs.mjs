// The rule documents a project already has for its agents and contributors: instruction files (CLAUDE.md,
// AGENTS.md, Cursor and Copilot rules), the rule and doc folders under .claude/, and the contributor docs
// whose name says they hold conventions. Read-only: paths, size, headings and the hecpack topics each one
// touches, so /init and /preview can go through them and say what to carry over and what conflicts.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const INSTRUCTION_FILES = [
  'CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', 'GEMINI.md', '.cursorrules',
  '.github/copilot-instructions.md', '.windsurfrules', 'CONTRIBUTING.md', '.github/CONTRIBUTING.md',
];
const RULE_DIRS = ['.claude/rules', '.claude/docs', '.cursor/rules', '.agents/rules', 'docs/agents', 'docs/ai'];
const DOC_DIRS = ['docs', 'doc', '.github'];
const DOC_NAME = /contribut|convention|guideline|architect|style|workflow|rules|agents|principle|coding|standard|review|testing|process|handbook/i;
const MAX_DOCS = 40;
const MAX_DEPTH = 4;
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', 'tmp', 'design-canvases', 'design-proposals', '__pycache__']);

// hecpack core topics; a doc that touches one may agree with, add to or contradict the core rule for it.
export const TOPICS = {
  language: ['language', 'english', 'russian', 'reply in', 'replies', 'язык', 'по-русски', 'на русском'],
  triage: ['triage', 'size the task', 'task size', 'small task', 'estimate', 'триаж', 'оценка задачи'],
  review: ['review', 'reviewer', 'architect', 'code review', 'approve', 'ревью', 'архитектор'],
  validation: ['typecheck', 'lint', 'eslint', 'tests', 'test suite', 'npm test', 'yarn test', 'pnpm test', 'validation', 'ci', 'проверки', 'тесты'],
  testing: ['unit test', 'tests next to', 'test coverage', 'tdd', 'assert', 'jest', 'vitest', 'pytest'],
  git: ['commit', 'branch', 'pull request', 'push', 'rebase', 'git ', 'коммит', 'ветка'],
  dependencies: ['dependency', 'dependencies', 'package.json', 'install', 'зависимост'],
  structure: ['folder', 'directory', 'layer', 'module', 'import', 'structure', 'папк', 'слой', 'структур'],
  docs: ['docs', 'documentation', 'readme', 'keep current', 'документац'],
  agents: ['subagent', 'agent', 'model', 'opus', 'sonnet', 'haiku', 'агент', 'модел'],
  context: ['context', 'compact', 'handoff', 'session', 'memory', 'контекст', 'сессия'],
  reports: ['report', 'summary', 'progress', 'verbose', 'concise', 'отчёт', 'отчет', 'кратко'],
  style: ['naming', 'format', 'prettier', 'indent', 'semicolon', 'style guide', 'именован', 'форматир'],
};

const isDir = (path) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

const walk = (dir, depth, out) => {
  if (depth > MAX_DEPTH || !isDir(dir)) return;
  for (const name of readdirSync(dir).sort()) {
    if (SKIP.has(name) || (name.startsWith('.') && depth > 0)) continue;
    const path = join(dir, name);
    if (isDir(path)) walk(path, depth + 1, out);
    else if (/\.(md|mdc|txt)$/i.test(name)) out.push(path);
  }
};

const headingsOf = (text) =>
  [...text.matchAll(/^#{1,3}\s+(.+?)\s*$/gm)].map(([, heading]) => heading).slice(0, 12);

export const topicsOf = (text) => {
  const lower = text.toLowerCase();
  return Object.entries(TOPICS)
    .filter(([, words]) => words.some((word) => lower.includes(word)))
    .map(([topic]) => topic);
};

const kindOf = (path) => {
  if (/(^|\/)(CLAUDE|CLAUDE\.local|AGENTS|GEMINI)\.md$/.test(path) || /cursorrules|windsurfrules|copilot-instructions/.test(path)) return 'instructions';
  if (/\.claude\/agents\//.test(path)) return 'agent';
  if (/\.claude\/skills\//.test(path)) return 'skill';
  if (/\.claude\/(rules|docs)\/|\.cursor\/rules\//.test(path)) return 'rules';
  return 'doc';
};

// Every rule document, ordered: instruction files first, then rule folders, then named docs; at most MAX_DOCS.
export const findDocs = (root, workspaces = []) => {
  const seen = new Set();
  const files = [];
  const add = (path) => {
    const rel = relative(root, path);
    if (seen.has(rel) || !existsSync(path) || isDir(path)) return;
    seen.add(rel);
    files.push(path);
  };
  for (const dir of ['', ...workspaces]) for (const file of INSTRUCTION_FILES) add(join(root, dir, file));
  for (const dir of RULE_DIRS) {
    const found = [];
    walk(join(root, dir), 0, found);
    found.forEach(add);
  }
  const agents = join(root, '.claude/agents');
  if (isDir(agents)) for (const name of readdirSync(agents).sort()) if (name.endsWith('.md')) add(join(agents, name));
  const skills = join(root, '.claude/skills');
  if (isDir(skills)) for (const name of readdirSync(skills).sort()) add(join(skills, name, 'SKILL.md'));
  for (const dir of DOC_DIRS) {
    const found = [];
    walk(join(root, dir), 0, found);
    found.filter((path) => DOC_NAME.test(relative(root, path))).forEach(add);
  }
  return files.slice(0, MAX_DOCS).map((path) => {
    const text = readFileSync(path, 'utf8');
    const rel = relative(root, path);
    return {
      path: rel,
      kind: kindOf(rel),
      bytes: Buffer.byteLength(text),
      lines: text.split('\n').length,
      headings: headingsOf(text),
      topics: topicsOf(text),
    };
  });
};
