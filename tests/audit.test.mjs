import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { audit, auditText, rolesOf } from '../scripts/lib/audit.mjs';
import { withoutReason } from '../scripts/hooks/agent-model.mjs';
import { agentIds, plan } from '../scripts/lib/plan.mjs';
import { detect } from '../scripts/lib/detect.mjs';
import { findSources } from '../scripts/lib/sources.mjs';
import { catalog, FIXTURES, packs, PLUGIN, scratch } from './helpers.mjs';

const put = (file, text) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof text === 'string' ? text : JSON.stringify(text));
};
const skill = (name, description, extra = '') => `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\n# ${name}\n`;
const plugin = (dir, name, description) => put(join(dir, '.claude-plugin/plugin.json'), { name, description });
const AGENTS = ['hecpack:checker', 'hecpack:architect', 'hecpack:thinker', 'hecpack:designer'];

// A Claude home with plugins installed three ways (recorded install path, cache, synced) and the user's
// own skills and commands, next to a project with its own agent, command, hook and MCP server.
const world = () => {
  const home = scratch();
  const root = scratch();
  const kit = join(home, 'plugins/cache/market/design-kit/1.0.0');
  plugin(kit, 'design-kit', 'UI design helpers');
  put(join(kit, 'skills/ui-designer/SKILL.md'), skill('ui-designer', 'Makes screens look good.'));
  put(join(kit, 'hooks/hooks.json'), { hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'node inject.js' }] }] } });
  put(join(kit, '.mcp.json'), { mcpServers: { figma: { command: 'npx', args: ['figma-mcp'] } } });
  const tools = join(home, 'plugins/cache/market/pr-tools/2.0.0');
  plugin(tools, 'pr-tools', 'Pull request helpers');
  put(join(tools, 'commands/review-pr.md'), '---\ndescription: Review the code of a pull request\n---\nReview it.\n');
  const old = join(home, 'plugins/cache/market/old-kit/0.1.0');
  plugin(old, 'old-kit', 'Planning agents');
  put(join(old, 'agents/planner.md'), '---\nname: planner\ndescription: Writes implementation plans\n---\n');
  const fd = join(home, 'plugins/synced/org/uuid1');
  plugin(fd, 'frontend-design', 'Design guidance');
  put(join(fd, 'skills/frontend-design/SKILL.md'), skill('frontend-design', 'Guidance for distinctive visual design.'));
  put(join(home, 'plugins/installed_plugins.json'), { version: 2, plugins: { 'design-kit@market': [{ installPath: kit }] } });
  put(join(home, 'settings.json'), { enabledPlugins: { 'old-kit@market': false } });
  put(join(home, 'skills/debugger/SKILL.md'), skill('debugger', 'Finds the root cause of a failure.'));
  put(join(home, 'skills/deploy-notes/SKILL.md'), skill('deploy-notes', 'Writes release notes.', 'disable-model-invocation: true\n'));
  put(join(home, 'commands/deploy.md'), '---\ndescription: Deploy the app\n---\n');
  put(join(root, '.claude/agents/architect.md'), '---\nname: architect\ndescription: Our own architecture review\n---\n');
  put(join(root, '.claude/commands/deploy.md'), '---\ndescription: Deploy this project\n---\n');
  put(join(root, '.claude/settings.json'), { hooks: { PreToolUse: [{ matcher: 'Agent', hooks: [{ type: 'command', command: 'check-agent.sh' }] }] } });
  put(join(root, '.mcp.json'), { mcpServers: { figma: { command: 'npx', args: ['figma-mcp'] } } });
  return { home, root };
};

const find = (result, predicate) => result.conflicts.find(predicate);

test('jobs come from a name word or a specific phrase, not a word in passing', () => {
  assert.deepEqual(rolesOf({ name: 'code-review', description: 'Code review a pull request' }), ['review']);
  assert.deepEqual(rolesOf({ name: 'expo-data-fetching', description: 'Use when implementing or debugging any network request' }), []);
  assert.deepEqual(rolesOf({ name: 'expo-ui', description: 'Build native UI with the @expo/ui package' }), []);
  assert.deepEqual(rolesOf({ source: 'hecpack', type: 'agent', name: 'thinker' }), ['debugging']);
});

test('installed plugins are found three ways and an off plugin takes no part', () => {
  const { home, root } = world();
  const result = audit({ root, claudeHome: home, pluginRoot: PLUGIN, agentList: AGENTS });
  assert.deepEqual(result.plugins.map((item) => [item.name, item.enabled]), [['design-kit', true], ['frontend-design', true], ['old-kit', false], ['pr-tools', true]]);
  assert.equal(result.plugins[0].id, 'design-kit@market');
  assert.deepEqual(result.plugins[0].counts, { skill: 1, hook: 1, mcp: 1 });
  assert.ok(!result.conflicts.some((conflict) => conflict.items.some((item) => item.name === 'planner')), 'old-kit is off');
  assert.deepEqual(result.local.user, { skill: 2, command: 1 });
});

test('clashes and overlaps with hecpack and between the others', () => {
  const { home, root } = world();
  const result = audit({ root, claudeHome: home, pluginRoot: PLUGIN, agentList: AGENTS });
  const prompt = find(result, (conflict) => conflict.kind === 'hook' && conflict.event === 'UserPromptSubmit');
  assert.equal(prompt.severity, 'clash');
  assert.ok(prompt.withHecpack && prompt.items.some((item) => item.source === 'plugin:design-kit'));
  assert.equal(find(result, (conflict) => conflict.event === 'PreToolUse (Agent)').severity, 'clash');
  const design = find(result, (conflict) => conflict.role === 'design');
  assert.equal(design.severity, 'clash', 'ui-designer competes with the designer');
  assert.equal(design.items.find((item) => item.name === 'frontend-design').usedBy, 'hecpack:designer');
  assert.equal(find(result, (conflict) => conflict.role === 'debugging').severity, 'clash');
  const planning = find(result, (conflict) => conflict.role === 'planning');
  assert.deepEqual(planning.sameName, ['architect']);
  assert.ok(!find(result, (conflict) => conflict.kind === 'name' && conflict.name === 'agent:architect'), 'the same name is told once');
  assert.equal(find(result, (conflict) => conflict.role === 'review').severity, 'overlap', 'review-pr runs only when called');
  assert.equal(find(result, (conflict) => conflict.kind === 'name' && conflict.name === 'command:deploy').severity, 'overlap');
  assert.equal(find(result, (conflict) => conflict.kind === 'mcp').name, 'figma');
  assert.ok(result.conflicts.every((conflict) => conflict.items.every((item) => item.file)), 'every item names its file');
  const order = result.conflicts.map((conflict) => conflict.severity);
  assert.deepEqual(order, [...order].sort((a, b) => ['clash', 'overlap', 'together'].indexOf(a) - ['clash', 'overlap', 'together'].indexOf(b)));
  assert.match(auditText(result), /^Installed: 4 plugins \(1 off\)/);
  assert.match(auditText(result), /frontend-design \(used by hecpack:designer\)/);
});

test('a skill hecpack calls on works together with it', () => {
  const home = scratch();
  const root = scratch();
  const fd = join(home, 'plugins/synced/org/uuid1');
  plugin(fd, 'frontend-design', 'Design guidance');
  put(join(fd, 'skills/frontend-design/SKILL.md'), skill('frontend-design', 'Guidance for distinctive visual design.'));
  const result = audit({ root, claudeHome: home, pluginRoot: PLUGIN, agentList: AGENTS });
  assert.deepEqual(result.conflicts.map((conflict) => [conflict.role, conflict.severity]), [['design', 'together']]);
  const none = audit({ root: scratch(), claudeHome: scratch(), pluginRoot: PLUGIN, agentList: AGENTS });
  assert.deepEqual(none.conflicts, []);
  assert.match(auditText(none), /No overlaps/);
});

test('an optional hecpack agent can be left out, and its calls are refused', () => {
  assert.deepEqual(agentIds(['designer', 'hecpack:e2e-runner']), ['hecpack:designer', 'hecpack:e2e-runner']);
  assert.throws(() => agentIds(['checker']), /can be left out/);
  const root = join(FIXTURES, 'ts-vite');
  const detection = detect(root, catalog());
  const sources = findSources({ techs: detection.techs, packs: packs(), plugins: [], enabled: new Set() });
  const files = plan({ detection, sources, level: 'standard', without: ['hecpack:designer'], readProject: () => undefined, date: '2026-11-03' });
  const config = JSON.parse(files.find((item) => item.path.endsWith('config.json')).content);
  assert.deepEqual(config.without, ['hecpack:designer']);
  assert.ok(!('hecpack:designer' in config.agentModels));
  const map = JSON.parse(files.find((item) => item.path.endsWith('context-map.json')).content);
  assert.ok(!('hecpack:designer' in map.agents) && !map.types.design);
  const full = plan({ detection, sources, level: 'standard', readProject: () => undefined, date: '2026-11-03' });
  assert.equal(JSON.parse(full.find((item) => item.path.endsWith('config.json')).content).without, undefined);
  assert.match(withoutReason(config.without, 'hecpack:designer'), /left out in this project/);
  assert.equal(withoutReason(config.without, 'hecpack:checker'), false);
  assert.equal(withoutReason(undefined, 'hecpack:designer'), false);
});
