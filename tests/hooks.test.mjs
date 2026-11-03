import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { planParts, promptTypes, renderPart } from '../scripts/hooks/context.mjs';
import { modelReason } from '../scripts/hooks/agent-model.mjs';
import { PLUGIN, scratch } from './helpers.mjs';

const manifest = {
  limit: 10000, parts: { prompt: 4, agent: 4 }, untagged: 'code',
  tags: { q: 'q', s: 'code', coord: 'coord' }, keywords: { coord: ['coordinator'] },
  types: { q: ['hecpack:core/session.md'], code: ['hecpack:core/session.md', 'hecpack:core/workflow.md'], coord: ['hecpack:core/coordination.md'] },
  agents: { 'hecpack:checker': ['notes.md'] },
};

test('tags pick types; untagged prompts get the default plus keyword types', () => {
  assert.deepEqual(promptTypes('[q] why?', manifest), ['q']);
  assert.deepEqual(promptTypes('fix the button', manifest), ['code']);
  assert.deepEqual(promptTypes('act as coordinator', manifest), ['code', 'coord']);
});

test('parts stay under the limit and plugin paths resolve into the plugin', () => {
  const parts = planParts({ manifest, specs: manifest.types.code, root: scratch() });
  assert.ok(parts.every((part) => part.length <= manifest.limit));
  assert.match(renderPart({ parts, part: 1, count: 4, label: 'code work' }), /=== hecpack:core\/session.md ===/);
});

test('the hooks are silent in a project hecpack has not set up', () => {
  const root = scratch();
  const input = JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'hi', session_id: 's', cwd: root });
  for (const script of ['context.mjs', 'agent-model.mjs', 'after-compact.mjs']) {
    const out = execFileSync('node', [join(PLUGIN, 'scripts/hooks', script), '--part', '1'], { input, env: { ...process.env, CLAUDE_PROJECT_DIR: root } });
    assert.equal(out.toString(), '', script);
  }
});

test('the context hook injects for a set-up project and for its agents', () => {
  const root = scratch();
  mkdirSync(join(root, '.claude/hecpack'), { recursive: true });
  writeFileSync(join(root, '.claude/hecpack/context-map.json'), JSON.stringify(manifest));
  writeFileSync(join(root, 'notes.md'), '# Notes\nvalidation: npm test\n');
  const run = (input) => JSON.parse(execFileSync('node', [join(PLUGIN, 'scripts/hooks/context.mjs'), '--part', '1'], {
    input: JSON.stringify({ session_id: 's1', cwd: root, ...input }), env: { ...process.env, CLAUDE_PROJECT_DIR: root },
  }).toString());
  const prompt = run({ hook_event_name: 'UserPromptSubmit', prompt: '[s] fix it' });
  assert.match(prompt.hookSpecificOutput.additionalContext, /# Workflow/);
  const agent = run({ hook_event_name: 'SubagentStart', agent_type: 'hecpack:checker' });
  assert.match(agent.hookSpecificOutput.additionalContext, /validation: npm test/);
});

test('model overrides must fit agentModels', () => {
  const table = { 'hecpack:checker': { model: 'sonnet' }, 'hecpack:architect': { models: ['opus', 'sonnet'] } };
  assert.equal(modelReason(table, 'hecpack:checker', 'sonnet'), false);
  assert.match(modelReason(table, 'hecpack:checker', 'opus'), /runs on sonnet/);
  assert.equal(modelReason(table, 'hecpack:architect', 'sonnet'), false);
  assert.equal(modelReason(table, 'other', 'haiku'), false);
});
