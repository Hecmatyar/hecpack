// An audit of what is already installed around a project: plugins (from the user's Claude Code), the user's
// and the project's own skills, agents, commands, hooks and MCP servers. It finds where they overlap with
// each other and with what hecpack would add: hooks on the same events, components with the same job, the
// same name in two places, the same MCP server twice. Read-only; the skills turn the findings into a
// comparison and a recommendation.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
};
const read = (file) => {
  try {
    return readFileSync(file, 'utf8');
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
const list = (dir) => (isDir(dir) ? readdirSync(dir) : []);

const frontmatter = (text = '') => {
  const head = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
  const field = (key) => {
    const lines = head.split('\n');
    const at = lines.findIndex((line) => line.startsWith(`${key}:`));
    if (at === -1) return undefined;
    const value = lines[at].slice(key.length + 1).trim();
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
  return { field };
};

const short = (text = '', max = 220) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

// The jobs a component can do, read from its name (a word of it) or from a specific phrase in its
// description; a word that only appears in passing ("debugging a request") is not enough. hecpack's own
// components carry their jobs explicitly (HECPACK_ROLES).
export const ROLES = {
  workflow: { names: ['superpowers', 'brainstorming', 'tdd', 'methodology', 'triage'], phrases: /\b(development (workflow|methodology)|test-driven|brainstorm\w*|triage)\b/ },
  planning: { names: ['architect', 'architecture', 'planner', 'planning'], phrases: /\b(implementation plans?|architecture (review|analysis|design)|technical design)\b/ },
  review: { names: ['review', 'reviewer', 'code-review'], phrases: /\b(reviews? (the |a |your )?(code|diffs?|changes|pull requests?|prs?)|code review)\b/ },
  debugging: { names: ['debug', 'debugger', 'debugging', 'root-cause'], phrases: /\b(root[- ]cause|systematic debugging)\b/ },
  validation: { names: ['lint', 'linter', 'typecheck', 'checker', 'validate', 'validator'], phrases: /\b(runs? (the |your )?(typecheck|lint|linters|test suite|tests))\b/ },
  e2e: { names: ['e2e', 'playwright', 'cypress', 'maestro', 'tester'], phrases: /\b(end-to-end tests?|e2e (tests?|suite))\b/ },
  design: { names: ['design', 'designer', 'frontend-design', 'design-system'], phrases: /\b(design system|ui design|visual design|frontend design|mockups?)\b/ },
  context: { names: ['context', 'memory', 'handoff'], phrases: /\b(inject\w* (the )?(context|rules)|context engineering|handoff notes?|memory bank)\b/ },
  coordination: { names: ['orchestrator', 'coordinator', 'parallel', 'dispatch'], phrases: /\b(parallel (agents|sessions|subagents)|orchestrat\w* (agents|subagents|sessions)|sub-?sessions)\b/ },
  usage: { names: ['usage', 'cost', 'tokens'], phrases: /\b(token usage|usage (stats|report|dashboard)|cost tracking)\b/ },
};

const HECPACK_ROLES = {
  'agent:architect': ['planning', 'review'],
  'agent:thinker': ['debugging'],
  'agent:checker': ['validation'],
  'agent:designer': ['design'],
  'agent:e2e-runner': ['e2e'],
  'skill:init': ['workflow'],
  'skill:context': ['context'],
  'skill:coord': ['coordination'],
  'skill:usage': ['usage'],
  core: ['workflow', 'context', 'coordination'],
};

// Components of other plugins that a hecpack component calls on when they are installed: these work
// together rather than compete.
const HECPACK_USES = {
  'agent:designer': ['frontend-design'],
};

export const rolesOf = (component) => {
  if (component.source === 'hecpack') return HECPACK_ROLES[component.type === 'core' ? 'core' : `${component.type}:${component.name}`] ?? [];
  const name = component.name.toLowerCase();
  const words = new Set([name, ...name.split(/[-_:\s]+/)]);
  const text = (component.description ?? '').toLowerCase();
  return Object.entries(ROLES).filter(([, role]) => role.names.some((word) => words.has(word)) || role.phrases.test(text)).map(([role]) => role);
};

// The components of a plugin folder: what its manifest names, else the default folders.
const pluginComponents = (dir, source) => {
  const manifest = readJson(join(dir, '.claude-plugin/plugin.json')) ?? {};
  const out = [];
  const dirsOf = (key, fallback) => [fallback, ...[].concat(manifest[key] ?? []).filter((item) => typeof item === 'string').map((item) => item.replace(/^\.\//, ''))];
  for (const sub of new Set(dirsOf('skills', 'skills'))) {
    for (const name of list(join(dir, sub))) {
      const file = join(dir, sub, name, 'SKILL.md');
      const text = read(file);
      if (text === undefined) continue;
      const fm = frontmatter(text);
      out.push({ source, type: 'skill', name: fm.field('name') ?? name, description: short(fm.field('description')), auto: fm.field('disable-model-invocation') !== 'true', file });
    }
  }
  for (const sub of new Set(dirsOf('commands', 'commands'))) {
    for (const name of list(join(dir, sub)).filter((item) => item.endsWith('.md'))) {
      const file = join(dir, sub, name);
      const text = read(file) ?? '';
      const fm = frontmatter(text);
      out.push({ source, type: 'command', name: name.slice(0, -3), description: short(fm.field('description') ?? text.replace(/^---[\s\S]*?---/, '').trim().split('\n')[0]), auto: false, file });
    }
  }
  for (const sub of new Set(dirsOf('agents', 'agents'))) {
    for (const name of list(join(dir, sub)).filter((item) => item.endsWith('.md'))) {
      const file = join(dir, sub, name);
      const fm = frontmatter(read(file));
      out.push({ source, type: 'agent', name: fm.field('name') ?? name.slice(0, -3), description: short(fm.field('description')), auto: true, file });
    }
  }
  const inline = typeof manifest.hooks === 'object' && manifest.hooks;
  const hooksFile = inline ? join(dir, '.claude-plugin/plugin.json') : join(dir, typeof manifest.hooks === 'string' ? manifest.hooks : 'hooks/hooks.json');
  const hooks = inline ? manifest.hooks : readJson(hooksFile);
  out.push(...hookComponents(hooks?.hooks ?? hooks, source, hooksFile));
  const mcpInline = manifest.mcpServers && typeof manifest.mcpServers === 'object';
  const mcpFile = join(dir, mcpInline ? '.claude-plugin/plugin.json' : '.mcp.json');
  const mcp = mcpInline ? manifest.mcpServers : readJson(mcpFile)?.mcpServers;
  for (const [name, server] of Object.entries(mcp ?? {})) out.push({ source, type: 'mcp', name, description: short([server.command, ...(server.args ?? [])].join(' ') || server.url || ''), auto: true, file: mcpFile });
  return { name: manifest.name ?? basename(dir), description: short(manifest.description), components: out };
};

const hookComponents = (hooks, source, file) => {
  const out = [];
  for (const [event, groups] of Object.entries(hooks ?? {})) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      for (const hook of group.hooks ?? []) {
        out.push({ source, type: 'hook', name: `${event}${group.matcher ? ` (${group.matcher})` : ''}`, event, matcher: group.matcher ?? '', description: short(hook.command ?? hook.prompt ?? hook.type ?? ''), auto: true, file });
      }
    }
  }
  return out;
};

const localComponents = (base, source) => {
  const out = [];
  for (const name of list(join(base, 'skills'))) {
    const file = join(base, 'skills', name, 'SKILL.md');
    const text = read(file);
    if (text === undefined) continue;
    const fm = frontmatter(text);
    out.push({ source, type: 'skill', name: fm.field('name') ?? name, description: short(fm.field('description')), auto: fm.field('disable-model-invocation') !== 'true', file });
  }
  for (const name of list(join(base, 'agents')).filter((item) => item.endsWith('.md'))) {
    const file = join(base, 'agents', name);
    const fm = frontmatter(read(file));
    out.push({ source, type: 'agent', name: fm.field('name') ?? name.slice(0, -3), description: short(fm.field('description')), auto: true, file });
  }
  for (const name of list(join(base, 'commands')).filter((item) => item.endsWith('.md'))) {
    const file = join(base, 'commands', name);
    const fm = frontmatter(read(file));
    out.push({ source, type: 'command', name: name.slice(0, -3), description: short(fm.field('description')), auto: false, file });
  }
  for (const file of ['settings.json', 'settings.local.json']) out.push(...hookComponents(readJson(join(base, file))?.hooks, source, join(base, file)));
  return out;
};

// Plugin folders this Claude Code has: the install paths it records, its cache, and plugins synced from
// the user's account; the newest copy of each name wins.
export const installedPlugins = (claudeHome) => {
  const found = new Map();
  const add = (dir, id) => {
    if (!existsSync(join(dir, '.claude-plugin/plugin.json'))) return;
    const name = readJson(join(dir, '.claude-plugin/plugin.json'))?.name ?? basename(dir);
    const mtime = statSync(dir).mtimeMs;
    const known = found.get(name);
    if (!known || (!known.id && id) || (Boolean(known.id) === Boolean(id) && mtime > known.mtime)) found.set(name, { dir, id: id ?? known?.id, mtime });
  };
  const installed = readJson(join(claudeHome, 'plugins/installed_plugins.json'))?.plugins ?? {};
  for (const [id, entries] of Object.entries(installed)) {
    for (const entry of [].concat(entries ?? [])) if (entry?.installPath) add(entry.installPath, id);
  }
  const walk = (dir, depth) => {
    if (depth > 4 || !isDir(dir)) return;
    if (existsSync(join(dir, '.claude-plugin/plugin.json'))) return add(dir);
    for (const name of list(dir)) if (!name.startsWith('.')) walk(join(dir, name), depth + 1);
  };
  walk(join(claudeHome, 'plugins/cache'), 0);
  walk(join(claudeHome, 'plugins/synced'), 0);
  return found;
};

const disabledIn = (...settings) => {
  const off = new Set();
  for (const json of settings) for (const [id, on] of Object.entries(json?.enabledPlugins ?? {})) if (on === false) off.add(id.split('@')[0]);
  return off;
};

// What hecpack adds at a level: its agents for the stack, its hooks, its skills and the core rules.
const hecpackComponents = (pluginRoot, agentList) => {
  const { components } = pluginComponents(pluginRoot, 'hecpack');
  const chosen = new Set(agentList.map((name) => name.replace(/^hecpack:/, '')));
  return [
    { source: 'hecpack', type: 'core', name: 'core rules', description: 'triage S/M, architect loop, session and report rules, handoff, coordinator role; injected per prompt by its hook', auto: true, file: join(pluginRoot, 'core') },
    ...components.filter((component) => component.type !== 'agent' || chosen.has(component.name)),
  ];
};

const CONTEXT_EVENTS = new Set(['UserPromptSubmit', 'SessionStart', 'SubagentStart']);
const matchesAgentTool = (matcher) => matcher === '' || matcher === '*' || /(^|\|)(Agent|Task)(\||$)/.test(matcher) || matcher === '.*';

export const audit = ({ root, claudeHome = join(homedir(), '.claude'), pluginRoot, agentList = [] }) => {
  const userSettings = readJson(join(claudeHome, 'settings.json'));
  const projectSettings = [readJson(join(root, '.claude/settings.json')), readJson(join(root, '.claude/settings.local.json'))];
  const off = disabledIn(userSettings, ...projectSettings);
  const plugins = [];
  const components = [];
  for (const [name, info] of installedPlugins(claudeHome)) {
    if (name === 'hecpack') continue;
    const plugin = pluginComponents(info.dir, `plugin:${name}`);
    const enabled = !off.has(name);
    plugins.push({ name, id: info.id, description: plugin.description, enabled, counts: countByType(plugin.components) });
    if (enabled) components.push(...plugin.components);
  }
  components.push(...localComponents(claudeHome, 'user'));
  components.push(...localComponents(join(root, '.claude'), 'project'));
  for (const [name, server] of Object.entries(readJson(join(root, '.mcp.json'))?.mcpServers ?? {})) {
    components.push({ source: 'project', type: 'mcp', name, description: short([server.command, ...(server.args ?? [])].join(' ') || server.url || ''), auto: true, file: join(root, '.mcp.json') });
  }
  const ours = hecpackComponents(pluginRoot, agentList);
  for (const component of [...components, ...ours]) component.roles = rolesOf(component);
  const usedBy = (component) => ours.find((item) => (HECPACK_USES[`${item.type}:${item.name}`] ?? []).includes(component.name))?.name;

  const conflicts = [];
  const all = [...components, ...ours];
  const view = (component) => {
    const user = component.source === 'hecpack' ? undefined : usedBy(component);
    return { source: component.source, type: component.type, name: component.name, description: component.description, file: component.file, ...(user ? { usedBy: `hecpack:${user}` } : {}) };
  };

  // Hooks on the events where hecpack injects its rules, or on agent calls, where hecpack sets the model.
  const hecpackHookEvents = new Set(ours.filter((component) => component.type === 'hook').map((component) => component.event));
  for (const event of CONTEXT_EVENTS) {
    const theirs = components.filter((component) => component.type === 'hook' && component.event === event);
    if (!theirs.length) continue;
    const sources = new Set(theirs.map((component) => component.source));
    if (hecpackHookEvents.has(event)) conflicts.push({ kind: 'hook', event, severity: 'clash', withHecpack: true, items: [...theirs.map(view), ...ours.filter((component) => component.event === event).slice(0, 1).map(view)] });
    else if (sources.size > 1) conflicts.push({ kind: 'hook', event, severity: 'overlap', withHecpack: false, items: theirs.map(view) });
  }
  const agentHooks = components.filter((component) => component.type === 'hook' && component.event === 'PreToolUse' && matchesAgentTool(component.matcher));
  if (agentHooks.length) conflicts.push({ kind: 'hook', event: 'PreToolUse (Agent)', severity: 'clash', withHecpack: true, items: [...agentHooks.map(view), ...ours.filter((component) => component.event === 'PreToolUse').map(view)] });

  // Components with the same job from different sources. Two that can both start by themselves (hooks,
  // agents the model picks, skills without disable-model-invocation, the core rules) clash; two the user
  // calls by name only overlap; when every other one is something hecpack calls on, they work together.
  for (const role of Object.keys(ROLES)) {
    const doers = all.filter((component) => component.type !== 'hook' && component.type !== 'mcp' && component.roles.includes(role));
    const sources = new Set(doers.map((component) => component.source));
    if (sources.size < 2) continue;
    const autoSources = new Set(doers.filter((component) => component.auto).map((component) => component.source));
    const items = doers.map(view);
    const together = sources.has('hecpack') && items.every((item) => item.source === 'hecpack' || item.usedBy);
    // The same bare name as a hecpack agent: a brief has to use the prefix.
    const sameName = doers.filter((item) => item.source === 'project' || item.source === 'user').filter((item) => item.type === 'agent' && ours.some((our) => our.type === 'agent' && our.name === item.name)).map((item) => item.name);
    conflicts.push({ kind: 'role', role, severity: together ? 'together' : autoSources.size > 1 ? 'clash' : 'overlap', withHecpack: sources.has('hecpack'), items, ...(sameName.length ? { sameName } : {}) });
  }

  // One name in two places: user and project skills, agents and commands are not namespaced, so one hides
  // the other; a project agent named like a hecpack agent needs the prefix in every brief.
  const bare = components.filter((component) => (component.source === 'user' || component.source === 'project') && component.type !== 'hook' && component.type !== 'mcp');
  const byName = new Map();
  for (const component of bare) byName.set(`${component.type}:${component.name}`, [...(byName.get(`${component.type}:${component.name}`) ?? []), component]);
  for (const [key, items] of byName) if (items.length > 1) conflicts.push({ kind: 'name', name: key, severity: 'overlap', withHecpack: false, items: items.map(view) });
  const named = new Set(conflicts.flatMap((conflict) => conflict.sameName ?? []));
  for (const component of bare.filter((item) => item.type === 'agent' && !named.has(item.name))) {
    const twin = ours.find((item) => item.type === 'agent' && item.name === component.name);
    if (twin) conflicts.push({ kind: 'name', name: `agent:${component.name}`, severity: 'overlap', withHecpack: true, items: [view(component), view(twin)] });
  }

  // The same MCP server from two sources.
  const servers = new Map();
  for (const component of components.filter((item) => item.type === 'mcp')) servers.set(component.name, [...(servers.get(component.name) ?? []), component]);
  for (const [name, items] of servers) if (new Set(items.map((item) => item.source)).size > 1) conflicts.push({ kind: 'mcp', name, severity: 'overlap', withHecpack: false, items: items.map(view) });

  const rank = { clash: 0, overlap: 1, together: 2 };
  conflicts.sort((a, b) => rank[a.severity] - rank[b.severity] || Number(b.withHecpack) - Number(a.withHecpack));
  return {
    plugins: plugins.sort((a, b) => a.name.localeCompare(b.name)),
    local: { user: countByType(components.filter((item) => item.source === 'user')), project: countByType(components.filter((item) => item.source === 'project')) },
    hecpack: ours.map(view),
    conflicts,
  };
};

const countByType = (components) => {
  const out = {};
  for (const component of components) out[component.type] = (out[component.type] ?? 0) + 1;
  return out;
};

export const auditText = (result) => {
  const lines = [`Installed: ${result.plugins.length} plugin${result.plugins.length === 1 ? '' : 's'} (${result.plugins.filter((plugin) => !plugin.enabled).length} off), user and project skills, agents, commands and hooks.`];
  if (!result.conflicts.length) lines.push('No overlaps with each other or with hecpack.');
  for (const conflict of result.conflicts.slice(0, 8)) {
    const what = conflict.kind === 'role' ? `same job: ${conflict.role}` : conflict.kind === 'hook' ? `hooks on ${conflict.event}` : conflict.kind === 'name' ? `same name: ${conflict.name}` : `same MCP server: ${conflict.name}`;
    const severity = conflict.severity === 'together' ? 'works together' : conflict.severity;
    const items = conflict.items.map((item) => `${item.source} ${item.type} ${item.name}${item.usedBy ? ` (used by ${item.usedBy})` : ''}`).join('; ');
    lines.push(`- ${severity}${conflict.withHecpack ? ' with hecpack' : ''}, ${what}: ${items}${conflict.sameName ? `; same name as hecpack's: ${conflict.sameName.join(', ')}` : ''}`);
  }
  if (result.conflicts.length > 8) lines.push(`… and ${result.conflicts.length - 8} more on the page.`);
  return lines.join('\n');
};
