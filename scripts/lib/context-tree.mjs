// The context tree of a project: for every main-session mode and every agent, the .md files that reach its
// context at start (what Claude Code loads by itself, what the hecpack hook injects, the agent's own body)
// and the files those link to, which the agent reads only when the task needs them. Also the rules that
// load by path, the agent docs nobody reaches, and the files that repeat each other. Read-only.
//
// Tokens are an estimate, characters / 4: good for comparing files and readers, not a measurement.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, posix, relative, resolve } from 'node:path';
import { findDocs } from './docs.mjs';
import { projectSlug } from './usage.mjs';
import { HOOK_PARTS } from '../hooks/context.mjs';

export const tok = (text) => Math.round(text.length / 4);

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', 'tmp', '.next', '.expo', '.turbo', '.nx', 'Pods', 'vendor', 'target', '.venv', 'venv', '__pycache__', 'DerivedData', 'worktrees']);
// hecpack's map; the second is where the Wayfarer setup hecpack grew from keeps the same format.
const MANIFESTS = ['.claude/hecpack/context-map.json', '.claude/context-map.json'];
const MEMORY_LINES = 200; // Claude Code loads the first 200 lines of MEMORY.md
const IMPORT_DEPTH = 5;

const read = (path) => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
};

const isFile = (path) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

// The project's .md files: what git tracks or would track (its .gitignore decides), else a walk.
const projectMarkdown = (root) => {
  const listed = spawnSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '*.md', '.cursorrules', '.windsurfrules'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (listed.status === 0 && listed.stdout) {
    return listed.stdout.split('\0').filter((path) => path && !path.split('/').some((part) => SKIP.has(part)) && isFile(join(root, path)));
  }
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 8) return;
    let names;
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (SKIP.has(name)) continue;
      const path = join(dir, name);
      let stat;
      try {
        stat = statSync(path);
      } catch {
        continue;
      }
      if (stat.isDirectory()) walk(path, depth + 1);
      else if (name.endsWith('.md')) out.push(relative(root, path).split('\\').join('/'));
    }
  };
  walk(root, 0);
  return out;
};

const frontmatter = (text) => {
  const match = text.match(/^---\n([\s\S]*?)\n---\n?/);
  return { head: match?.[1] ?? '', body: match ? text.slice(match[0].length) : text };
};

const fmField = (head, key) => {
  const lines = head.split('\n');
  const at = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (at === -1) return undefined;
  const value = lines[at].slice(key.length + 1).trim();
  // A YAML block scalar (`>` or `|`) continues on the indented lines below.
  if (/^[>|][-+]?$/.test(value) || value === '') {
    const block = [];
    for (const line of lines.slice(at + 1)) {
      if (!/^\s+\S/.test(line)) break;
      block.push(line.trim());
    }
    return block.join(' ') || undefined;
  }
  return value.replace(/^["']|["']$/g, '');
};

// `paths:` of a rule file, as a YAML list or an inline value.
const fmPaths = (head) => {
  const block = head.match(/^paths:\s*\n((?:\s+-\s*.+\n?)+)/m);
  if (block) return [...block[1].matchAll(/-\s*['"]?([^'"\n]+?)['"]?\s*$/gm)].map((match) => match[1]);
  const inline = fmField(head, 'paths');
  if (!inline) return [];
  return inline.replace(/^\[|\]$/g, '').split(',').map((item) => item.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
};

// Every file a reader may get, by key: project paths as they are, plugin files as `hecpack:<path>`, the
// user's CLAUDE.md as `~/.claude/CLAUDE.md`, the project's auto memory as `memory/<name>`.
export const inventory = ({ root, claudeHome = join(homedir(), '.claude'), pluginRoot }) => {
  const files = {};
  for (const path of projectMarkdown(root)) {
    const text = read(join(root, path));
    if (text !== undefined) files[path] = { text, scope: 'project' };
  }
  for (const dir of ['core', 'agents']) {
    for (const name of existsSync(join(pluginRoot, dir)) ? readdirSync(join(pluginRoot, dir)) : []) {
      if (name.endsWith('.md')) files[`hecpack:${dir}/${name}`] = { text: read(join(pluginRoot, dir, name)), scope: 'plugin' };
    }
  }
  const userMd = read(join(claudeHome, 'CLAUDE.md'));
  if (userMd !== undefined) files['~/.claude/CLAUDE.md'] = { text: userMd, scope: 'user' };
  const memoryDir = join(claudeHome, 'projects', projectSlug(root), 'memory');
  for (const name of existsSync(memoryDir) ? readdirSync(memoryDir) : []) {
    if (name.endsWith('.md')) files[`memory/${name}`] = { text: read(join(memoryDir, name)) ?? '', scope: 'memory' };
  }
  return files;
};

// Links: any word ending in .md (a path, a markdown link, a backticked name), resolved against the file's
// own folder, then by path suffix, then by a basename only one file has. `@path` imports in CLAUDE.md files
// are loaded with them and are resolved the same way.
const LINK = /[\w@~./[\]-]*?[\w-]+\.md\b/g;

export const linkGraph = (files) => {
  const keys = Object.keys(files);
  const byBase = new Map();
  for (const key of keys) {
    const base = posix.basename(key);
    byBase.set(base, [...(byBase.get(base) ?? []), key]);
  }
  const resolveLink = (src, raw) => {
    const link = raw.replace(/^@/, '').replace(/^\.\//, '');
    if (files[link] && link !== src) return link;
    if (link.includes('/')) {
      const srcDir = src.startsWith('hecpack:') ? `hecpack:${posix.dirname(src.slice(8))}` : posix.dirname(src);
      const near = posix.normalize(posix.join(srcDir.replace(/^hecpack:/, ''), link));
      const nearKey = src.startsWith('hecpack:') ? `hecpack:${near}` : near;
      if (files[nearKey] && nearKey !== src) return nearKey;
      if (files[`hecpack:${link}`]) return `hecpack:${link}`;
      const tail = `/${link.replace(/^~\/\.claude\//, '')}`;
      const hits = (byBase.get(posix.basename(link)) ?? []).filter((key) => key.endsWith(tail) || key === link);
      if (hits.length === 1 && hits[0] !== src) return hits[0];
      return undefined;
    }
    if (src.startsWith('memory/') && files[`memory/${link}`]) return `memory/${link}`;
    // A bare name is a link only when one file has it (and that file is not the one naming it).
    const same = byBase.get(link) ?? [];
    return same.length === 1 && same[0] !== src ? same[0] : undefined;
  };
  const graph = {};
  for (const key of keys) {
    const out = new Set();
    for (const match of (files[key].text ?? '').matchAll(LINK)) {
      const hit = resolveLink(key, match[0]);
      if (hit) out.add(hit);
    }
    graph[key] = out;
  }
  return { graph, resolveLink };
};

// `@path` imports of a CLAUDE.md, recursively; outside code fences only.
const importsOf = (key, files, resolveLink, depth = 0, seen = new Set([key])) => {
  if (depth >= IMPORT_DEPTH) return [];
  const text = (files[key]?.text ?? '').replace(/```[\s\S]*?```/g, '');
  const out = [];
  for (const match of text.matchAll(/(?:^|\s)@([\w~./-]+\.md)\b/g)) {
    const hit = resolveLink(key, match[1]);
    if (hit && !seen.has(hit)) {
      seen.add(hit);
      out.push(hit, ...importsOf(hit, files, resolveLink, depth + 1, seen));
    }
  }
  return out;
};

// The text of a context-map spec: `path`, `path#Heading` (one `## Heading` section), `...~top` (only the
// unindented lines).
export const specText = (files, spec) => {
  const top = spec.endsWith('~top');
  const [path, heading] = (top ? spec.slice(0, -4) : spec).split('#');
  let text = files[path]?.text;
  if (text === undefined) return { path, text: '', missing: true };
  if (heading) {
    const start = text.indexOf(`\n## ${heading}\n`);
    if (start === -1) return { path, text: '', missing: true };
    const end = text.indexOf('\n## ', start + 1);
    text = text.slice(start + 1, end === -1 ? undefined : end);
  }
  if (top) text = text.split('\n').filter((line) => !/^\s/.test(line)).join('\n');
  return { path, text };
};

// The line of `src` that mentions `dst`: the "when to read it" a reader sees next to the link.
const whenLine = (files, src, dst) => {
  const name = posix.basename(dst).replace(/\.md$/, '');
  for (const line of (files[src]?.text ?? '').split('\n')) {
    if (!line.includes(name)) continue;
    const flat = line.trim().replace(/^[-*|>\s]+/, '').replace(/\s+/g, ' ');
    if (flat.length <= 160) return flat;
    const at = flat.indexOf(name);
    return flat.slice(Math.max(0, at - 100), at + 60).trim();
  }
  return '';
};

const shingles = (text, n = 8) => {
  const words = text.replace(/`[^`]*`/g, ' ').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const out = new Set();
  for (let i = 0; i + n <= words.length; i += 1) out.add(words.slice(i, i + n).join(' '));
  return out;
};

export const duplicates = (files, keys, limit = 15) => {
  const sets = keys.map((key) => [key, shingles(files[key].text ?? '')]).filter(([, set]) => set.size >= 6);
  const pairs = [];
  for (let i = 0; i < sets.length; i += 1) {
    for (let j = i + 1; j < sets.length; j += 1) {
      const [a, sa] = sets[i];
      const [b, sb] = sets[j];
      const [small, large] = sa.size <= sb.size ? [sa, sb] : [sb, sa];
      let shared = 0;
      for (const item of small) if (large.has(item)) shared += 1;
      if (shared < 6) continue;
      let example = '';
      let best = 0;
      for (const line of (files[a].text ?? '').split('\n')) {
        const lineSet = shingles(line);
        let hits = 0;
        for (const item of lineSet) if (sb.has(item)) hits += 1;
        if (hits > best) {
          best = hits;
          example = line.trim();
        }
      }
      const pct = Math.round((100 * shared) / small.size);
      if (pct < 10 && shared < 40) continue; // a few common phrases are not a duplicate
      pairs.push({ a, b, shared, pct, example: example.slice(0, 160) });
    }
  }
  return pairs.sort((x, y) => y.shared - x.shared).slice(0, limit);
};

const BUILTIN_AGENTS = new Set(['general-purpose', 'Explore', 'Plan', 'statusline-setup', 'claude-code-guide']);

// The tree: readers with what they get at start and by link, plus the file view.
export const contextTree = ({ root, claudeHome, pluginRoot }) => {
  root = resolve(root);
  const files = inventory({ root, claudeHome, pluginRoot });
  const { graph, resolveLink } = linkGraph(files);
  const manifestPath = MANIFESTS.find((path) => existsSync(join(root, path)));
  const manifest = (() => {
    try {
      return manifestPath ? JSON.parse(read(join(root, manifestPath))) : undefined;
    } catch {
      return undefined;
    }
  })();

  // What Claude Code loads into every session by itself: CLAUDE.md files and their imports, rules without
  // `paths:`, the first lines of the auto memory index; plus the one-line lists (agents, skills).
  const memoryKeys = ['~/.claude/CLAUDE.md', 'CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md'].filter((key) => files[key]);
  const imported = memoryKeys.flatMap((key) => importsOf(key, files, resolveLink));
  const ruleFiles = Object.keys(files).filter((key) => key.startsWith('.claude/rules/'));
  const pathRules = [];
  const alwaysRules = [];
  for (const key of ruleFiles) {
    const globs = fmPaths(frontmatter(files[key].text).head);
    if (globs.length) pathRules.push({ p: key, globs, tok: tok(files[key].text), kind: 'rule' });
    else alwaysRules.push(key);
  }
  for (const key of Object.keys(files)) {
    if (files[key].scope !== 'project' || posix.basename(key) !== 'CLAUDE.md' || key === 'CLAUDE.md' || key === '.claude/CLAUDE.md') continue;
    pathRules.push({ p: key, globs: [`${posix.dirname(key)}/**`], tok: tok(files[key].text), kind: 'nested' });
  }
  // hecpack's own agents are listed in a project set up by hecpack (the plugin is installed there).
  const withPlugin = manifestPath === MANIFESTS[0];
  const agentFiles = Object.keys(files).filter((key) => /^\.claude\/agents\/[^/]+\.md$/.test(key) || (withPlugin && key.startsWith('hecpack:agents/')));
  const agentList = agentFiles.map((key) => {
    const { head } = frontmatter(files[key].text);
    const name = fmField(head, 'name') ?? posix.basename(key, '.md');
    return { key, name: key.startsWith('hecpack:') ? `hecpack:${name}` : name, description: fmField(head, 'description') ?? '' };
  });
  const skillDescriptions = Object.keys(files)
    .filter((key) => /^\.claude\/skills\/[^/]+\/SKILL\.md$/.test(key))
    .map((key) => fmField(frontmatter(files[key].text).head, 'description') ?? '');

  const item = (p, tokens, src, extra = {}) => ({ p, tok: tokens, src, ...extra });
  const claudeItems = ({ main }) => {
    const out = [...memoryKeys, ...imported, ...alwaysRules].map((key) => item(key, tok(files[key].text), 'claude'));
    if (main && files['memory/MEMORY.md']) out.push(item('memory/MEMORY.md', tok(files['memory/MEMORY.md'].text.split('\n').slice(0, MEMORY_LINES).join('\n')), 'claude'));
    if (main && agentList.length) out.push(item('(agent descriptions)', tok(agentList.map((agent) => `${agent.name}: ${agent.description}`).join('\n')), 'list', { count: agentList.length }));
    if (main && skillDescriptions.length) out.push(item('(skill descriptions)', tok(skillDescriptions.join('\n')), 'list', { count: skillDescriptions.length }));
    return out;
  };

  const hookItems = (specs) => {
    const seen = new Set();
    const out = [];
    for (const spec of specs) {
      if (seen.has(spec)) continue;
      seen.add(spec);
      const { text, missing } = specText(files, spec);
      out.push(item(spec, tok(text), 'hook', missing ? { missing: true } : {}));
    }
    return out;
  };

  const readers = [];
  const addReader = ({ id, kind, name, trigger, start, hookLimit }) => {
    const seen = new Map();
    for (const entry of start) if (!seen.has(entry.p)) seen.set(entry.p, entry);
    const must = [...seen.values()];
    const base = new Set(must.map((entry) => entry.p.split('#')[0].replace(/~top$/, '')));
    const optional = [];
    for (const src of base) {
      for (const dst of graph[src] ?? []) {
        if (base.has(dst) || optional.some((entry) => entry.p === dst)) continue;
        optional.push({ p: dst, tok: tok(files[dst].text ?? ''), when: whenLine(files, src, dst), from: src });
      }
    }
    // Everything reachable through links, for the worst case.
    const reach = new Set(base);
    const queue = [...base];
    while (queue.length) {
      for (const dst of graph[queue.pop()] ?? []) {
        if (!reach.has(dst)) {
          reach.add(dst);
          queue.push(dst);
        }
      }
    }
    for (const key of base) reach.delete(key);
    must.sort((a, b) => b.tok - a.tok);
    optional.sort((a, b) => b.tok - a.tok);
    const hookChars = must.filter((entry) => entry.src === 'hook').reduce((sum, entry) => sum + specText(files, entry.p).text.length + entry.p.length + 10, 0);
    readers.push({
      id,
      kind,
      name,
      trigger,
      must,
      optional,
      mustTok: must.reduce((sum, entry) => sum + entry.tok, 0),
      optionalTok: optional.reduce((sum, entry) => sum + entry.tok, 0),
      worstTok: [...reach].reduce((sum, key) => sum + tok(files[key].text ?? ''), 0),
      reachCount: reach.size,
      hook: hookLimit ? { chars: hookChars, limit: hookLimit, over: hookChars > hookLimit } : undefined,
    });
  };

  const bodyItem = (agentName) => {
    const key = agentName.startsWith('hecpack:') ? `hecpack:agents/${agentName.slice(8)}.md` : `.claude/agents/${agentName}.md`;
    if (!files[key]) return [];
    return [item(key, tok(frontmatter(files[key].text).body), 'agent')];
  };

  if (manifest?.types) {
    const parts = { prompt: HOOK_PARTS, agent: HOOK_PARTS };
    const limit = manifest.limit ?? 10000;
    for (const [type, specs] of Object.entries(manifest.types)) {
      const tags = Object.entries(manifest.tags ?? {}).filter(([, value]) => value === type).map(([tag]) => tag);
      addReader({
        id: `main:${type}`,
        kind: 'main',
        name: type,
        trigger: { tags, untagged: manifest.untagged === type, keywords: (manifest.keywords?.[type] ?? []).slice(0, 4) },
        start: [...claudeItems({ main: true }), ...hookItems(specs)],
        hookLimit: parts.prompt * (limit - 200),
      });
    }
    for (const [agent, specs] of Object.entries(manifest.agents ?? {})) {
      addReader({
        id: `agent:${agent}`,
        kind: BUILTIN_AGENTS.has(agent) ? 'builtin' : 'agent',
        name: agent,
        trigger: { hook: true },
        start: [...bodyItem(agent), ...claudeItems({ main: false }), ...hookItems(specs)],
        hookLimit: parts.agent * (limit - 200),
      });
    }
  } else {
    addReader({ id: 'main', kind: 'main', name: 'main', trigger: { untagged: true, tags: [] }, start: claudeItems({ main: true }) });
  }
  const mapped = new Set(Object.keys(manifest?.agents ?? {}));
  for (const agent of agentList) {
    if (mapped.has(agent.name) || agent.key.startsWith('hecpack:')) continue;
    addReader({ id: `agent:${agent.name}`, kind: 'project-agent', name: agent.name, trigger: { hook: false }, start: [...bodyItem(agent.name), ...claudeItems({ main: false })] });
  }

  // The file view: who reads each file at start and who may reach it by link.
  const byFile = {};
  for (const reader of readers) {
    for (const entry of reader.must) {
      const key = entry.p.split('#')[0].replace(/~top$/, '');
      if (!files[key]) continue;
      byFile[key] ??= { auto: new Set(), link: new Set() };
      byFile[key].auto.add(reader.id);
    }
    for (const entry of reader.optional) {
      byFile[entry.p] ??= { auto: new Set(), link: new Set() };
      byFile[entry.p].link.add(reader.id);
    }
  }
  const fileRows = Object.entries(byFile)
    .map(([p, use]) => ({ p, tok: tok(files[p].text ?? ''), scope: files[p].scope, auto: [...use.auto], link: [...use.link].filter((id) => !use.auto.has(id)) }))
    .sort((a, b) => b.tok - a.tok);

  // Agent docs nobody reaches: under .claude/, instruction files anywhere, the project's rule documents.
  const reached = new Set(Object.keys(byFile));
  for (const reader of readers) {
    const queue = reader.must.map((entry) => entry.p.split('#')[0].replace(/~top$/, ''));
    while (queue.length) {
      const key = queue.pop();
      for (const dst of graph[key] ?? []) if (!reached.has(dst)) {
        reached.add(dst);
        queue.push(dst);
      }
    }
  }
  const linkedFrom = new Set(Object.values(graph).flatMap((set) => [...set]));
  const ruleDocs = new Set(findDocs(root, []).map((doc) => doc.path));
  const candidates = Object.keys(files).filter((key) =>
    files[key].scope === 'project' &&
    !key.startsWith('.claude/skills/') && !key.startsWith('.claude/agents/') &&
    (key.startsWith('.claude/') || ['CLAUDE.md', 'AGENTS.md'].includes(posix.basename(key)) || ruleDocs.has(key)));
  const pathRuleKeys = new Set(pathRules.map((rule) => rule.p));
  const orphans = candidates.filter((key) => !reached.has(key) && !linkedFrom.has(key) && !pathRuleKeys.has(key)).map((key) => ({ p: key, tok: tok(files[key].text) })).sort((a, b) => b.tok - a.tok);

  const mapKeys = [...new Set([...Object.keys(byFile), ...orphans.map((row) => row.p), ...pathRules.map((rule) => rule.p)])].filter((key) => files[key]);
  const projectTotal = Object.values(files).filter((file) => file.scope === 'project');

  // What costs most at start: a file's tokens times the readers that load it.
  const heavy = fileRows
    .filter((row) => row.auto.length)
    .map((row) => ({ p: row.p, tok: row.tok, readers: row.auto.length, cost: row.tok * row.auto.length, scope: row.scope }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 8);

  return {
    root,
    hecpack: Boolean(manifest?.types),
    manifest: manifest?.types ? manifestPath : undefined,
    readers,
    files: fileRows,
    pathRules: pathRules.sort((a, b) => b.tok - a.tok),
    orphans,
    duplicates: duplicates(files, mapKeys),
    heavy,
    missing: readers.flatMap((reader) => reader.must.filter((entry) => entry.missing).map((entry) => ({ reader: reader.id, p: entry.p }))),
    stats: {
      inMap: fileRows.length,
      inMapProject: fileRows.filter((row) => row.scope === 'project').length,
      inMapPlugin: fileRows.filter((row) => row.scope === 'plugin').length,
      projectFiles: projectTotal.length,
      projectTok: projectTotal.reduce((sum, file) => sum + tok(file.text ?? ''), 0),
    },
  };
};

const k = (value) => (value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value));

export const treeText = (tree) => {
  const label = (reader) => (reader.kind === 'main' ? `main · ${reader.name}` : reader.name);
  const lines = [`Project files in the map: ${tree.stats.inMapProject} of ${tree.stats.projectFiles} .md, hecpack files: ${tree.stats.inMapPlugin}. Tokens are an estimate, characters / 4.`];
  for (const reader of tree.readers) {
    lines.push(`- ${label(reader)}: ${k(reader.mustTok)} at start + ${k(reader.optionalTok)} by link${reader.hook?.over ? ' (over the hook parts)' : ''}`);
  }
  if (!tree.hecpack) lines.push('hecpack is not set up here: this is what Claude Code loads by itself.');
  if (tree.orphans.length) lines.push(`Read by nobody: ${tree.orphans.length} (${tree.orphans.slice(0, 3).map((row) => row.p).join(', ')}${tree.orphans.length > 3 ? '…' : ''}).`);
  if (tree.duplicates.length) {
    const top = tree.duplicates[0];
    lines.push(`Most repeated: ${top.a} and ${top.b} (${top.pct}% shared phrases).`);
  }
  if (tree.missing.length) lines.push(`Missing from the context map: ${tree.missing.map((row) => row.p).join(', ')}.`);
  return lines.join('\n');
};
