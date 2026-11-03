import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { HOOK_PARTS, planParts, promptTypes, renderPart } from '../scripts/hooks/context.mjs';
import { reportReason } from '../scripts/hooks/designer-report.mjs';
import { modelReason } from '../scripts/hooks/agent-model.mjs';
import { PLUGIN, scratch } from './helpers.mjs';

const manifest = {
  limit: 10000, untagged: 'code',
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
  for (const script of ['context.mjs', 'agent-model.mjs', 'after-compact.mjs', 'designer-report.mjs']) {
    const out = execFileSync('node', [join(PLUGIN, 'scripts/hooks', script), '--part', '1'], { input, env: { ...process.env, CLAUDE_PROJECT_DIR: root } });
    assert.equal(out.toString(), '', script);
  }
});

test('the context hook injects for a set-up project and for its agents', () => {
  const root = scratch();
  mkdirSync(join(root, '.claude/hecpack'), { recursive: true });
  writeFileSync(join(root, '.claude/hecpack/context-map.json'), JSON.stringify(manifest));
  writeFileSync(join(root, 'notes.md'), '# Notes\nvalidation: npm test\n');
  const run = (input, part = 1) => {
    const out = execFileSync('node', [join(PLUGIN, 'scripts/hooks/context.mjs'), '--part', String(part)], {
      input: JSON.stringify({ session_id: 's1', cwd: root, ...input }), env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    }).toString();
    return out ? JSON.parse(out).hookSpecificOutput.additionalContext : '';
  };
  // Each part is its own process, as Claude Code runs them: together they carry the whole set.
  const prompt = Array.from({ length: HOOK_PARTS }, (_, i) => run({ hook_event_name: 'UserPromptSubmit', prompt: '[s] fix it' }, i + 1)).join('\n');
  assert.match(prompt, /# Main session/);
  assert.match(prompt, /# Workflow/);
  assert.ok(!/More mandatory rules did not fit/.test(prompt));
  const agent = run({ hook_event_name: 'SubagentStart', agent_type: 'hecpack:checker' });
  assert.match(agent, /validation: npm test/);
});

test('model overrides must fit agentModels', () => {
  const table = { 'hecpack:checker': { model: 'sonnet' }, 'hecpack:architect': { models: ['opus', 'sonnet'] } };
  assert.equal(modelReason(table, 'hecpack:checker', 'sonnet'), false);
  assert.match(modelReason(table, 'hecpack:checker', 'opus'), /runs on sonnet/);
  assert.equal(modelReason(table, 'hecpack:architect', 'sonnet'), false);
  assert.equal(modelReason(table, 'other', 'haiku'), false);
});

test('hooks.json registers the context hook once per part, and the designer check for the designer only', () => {
  const hooks = JSON.parse(readFileSync(join(PLUGIN, 'hooks/hooks.json'), 'utf8')).hooks;
  for (const event of ['UserPromptSubmit', 'SubagentStart']) {
    const parts = hooks[event][0].hooks.map((hook) => Number(hook.command.match(/--part (\d+)/)?.[1]));
    assert.deepEqual(parts, Array.from({ length: HOOK_PARTS }, (_, i) => i + 1), event);
  }
  assert.equal(hooks.SubagentStop[0].matcher, '^hecpack:designer$');
  assert.equal(renderPart({ parts: ['a', 'b', 'c'], part: 3, count: 2, label: 'x' }), '', 'a part past the count prints nothing');
});

test('a designer report without the checklist line goes back once', () => {
  const report = 'Boards in tmp/design/form/.\nChecklist: checked touch targets, contrast — all pass';
  assert.equal(reportReason({ agent_type: 'hecpack:designer', last_assistant_message: report }), false);
  assert.match(reportReason({ agent_type: 'hecpack:designer', last_assistant_message: 'Boards done.' }), /Checklist: checked/);
  assert.equal(reportReason({ agent_type: 'hecpack:designer', last_assistant_message: 'Boards done.', stop_hook_active: true }), false);
  assert.equal(reportReason({ agent_type: 'Explore', last_assistant_message: 'Found it.' }), false);
  const root = scratch();
  const run = (cwd) => execFileSync('node', [join(PLUGIN, 'scripts/hooks/designer-report.mjs')], {
    input: JSON.stringify({ hook_event_name: 'SubagentStop', agent_type: 'hecpack:designer', last_assistant_message: 'Boards done.', cwd }), env: { ...process.env, CLAUDE_PROJECT_DIR: cwd },
  }).toString();
  assert.equal(run(root), '', 'silent where hecpack is not set up');
  mkdirSync(join(root, '.claude/hecpack'), { recursive: true });
  writeFileSync(join(root, '.claude/hecpack/config.json'), '{}');
  assert.equal(JSON.parse(run(root)).decision, 'block');
});
