import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bashStage, bucketOf, callStage, isArchitect, segments, toolStage } from '../scripts/lib/stages.mjs';

test('a shell command is a check, an edit or a search by its segments', () => {
  assert.equal(bashStage('cd /p && npm test'), 'validate');
  assert.equal(bashStage('npx --no-install vitest run src'), 'validate');
  assert.equal(bashStage('node --test tests/'), 'validate');
  assert.equal(bashStage('cargo clippy'), 'validate');
  assert.equal(bashStage('rg vitest src'), 'explore', 'a search for a check command stays a search');
  assert.equal(bashStage("sed -i 's/a/b/' x.ts"), 'edit');
  assert.equal(bashStage("python3 - <<'EOF'\nopen('x', 'w').write('y')\nEOF"), 'edit');
  assert.equal(bashStage('git log --oneline | head'), 'explore');
  assert.equal(bashStage('gh pr view 12'), 'other');
  assert.deepEqual(segments("FOO=1 time npm run lint; cat <<'EOF'\nnpm test\nEOF"), ['npm run lint', "cat <<'EOF'"]);
});

test('a call takes the first stage of its tools by priority; no tools is an answer; a question is service', () => {
  assert.equal(callStage([]), 'answer');
  assert.equal(callStage([{ name: 'Read' }, { name: 'Edit', input: { file_path: '/p/src/a.ts' } }]), 'edit');
  assert.equal(callStage([{ name: 'Edit', input: { file_path: '/p/README.md' } }]), 'docs');
  assert.equal(callStage([{ name: 'Read' }, { name: 'Agent', input: { subagent_type: 'hecpack:architect' } }]), 'architect');
  assert.equal(callStage([{ name: 'AskUserQuestion' }]), 'service');
  assert.equal(toolStage({ name: 'WebFetch' }), 'web');
  assert.equal(toolStage({ name: 'mcp__plugin_context7_context7__query-docs' }), 'web');
  assert.equal(toolStage({ name: 'Skill', input: { skill: 'frontend-design:frontend-design' } }), 'design');
  assert.equal(toolStage({ name: 'mcp__something__else' }), 'other');
  assert.ok(isArchitect('architect') && isArchitect('hecpack:architect') && !isArchitect('architect-helper'));
});

test('context buckets', () => {
  assert.equal(bucketOf(99_999), 'lt100k');
  assert.equal(bucketOf(150_000), '100to200k');
  assert.equal(bucketOf(250_000), '200to300k');
  assert.equal(bucketOf(1_000_000), 'gt300k');
});
