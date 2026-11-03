import assert from 'node:assert/strict';
import { existsSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { costOf, hecpackMarker, priceFor, readMessages, transcriptFiles, usageReport, usageText } from '../scripts/lib/usage.mjs';
import { parseArgs, usage } from '../scripts/usage.mjs';
import { FIXTURES, PLUGIN, scratch } from './helpers.mjs';

const HOME = join(FIXTURES, 'claude-home');
const prices = () => JSON.parse(readFileSync(join(PLUGIN, 'catalog/prices.json'), 'utf8'));

test('arguments', () => {
  const args = parseArgs(['--out', 'x', '--marker', '2026-10-05', '--claude-home', '/h', '--open', '--no-cache']);
  assert.equal(args.marker, '2026-10-05');
  assert.equal(args.claudeHome, '/h');
  assert.equal(args.open, true);
  assert.equal(args.cache, false);
  assert.throws(() => parseArgs(['--marker', 'yesterday']));
  assert.throws(() => parseArgs(['--lang', 'de']));
});

test('prices match the longest model id prefix and fall back for cache rates', () => {
  const p = prices();
  assert.equal(priceFor('claude-opus-5-5-20261001', p).label, 'Opus 5.5');
  assert.equal(priceFor('claude-opus-5', p).label, 'Opus 5');
  assert.equal(priceFor('claude-unknown-9', p), undefined);
  const one = { input: 1e6, cacheWrite: 1e6, cacheRead: 1e6, output: 1e6 };
  assert.equal(costOf(one, priceFor('claude-opus-5', p)), 5 + 6.25 + 0.5 + 25);
  assert.equal(costOf(one, priceFor('claude-opus-5-5', p)), 4 + 5 + 0.2 + 20);
});

test('transcripts are found by the project slug, subagent files included, messages counted once by id', () => {
  const files = transcriptFiles('/tmp/demo-project', HOME);
  assert.equal(files.length, 2);
  assert.ok(files.some((file) => file.endsWith('subagents/agent-a.jsonl')));
  const { messages, cache } = readMessages(files);
  assert.deepEqual(messages.map((message) => message.id), ['m1', 'm2', 'm3', 'm4', 'm5']);
  assert.equal(messages[0].cacheWrite, 20000);
  assert.equal(Object.keys(cache.files).length, 2);
  assert.deepEqual(transcriptFiles('/nowhere/at/all', HOME), []);
});

test('the cache skips unchanged files and re-reads a changed one', () => {
  const dir = scratch();
  const file = join(dir, 'a.jsonl');
  const line = (id, day) => `${JSON.stringify({ type: 'assistant', timestamp: `${day}T00:00:00Z`, message: { id, model: 'claude-sonnet-5-5', usage: { input_tokens: 1, output_tokens: 1 } } })}\n`;
  writeFileSync(file, line('a', '2026-10-01'));
  const first = readMessages([file]);
  first.cache.files[file].records[0].input = 99; // visible only if the cache is used
  const second = readMessages([file], first.cache);
  assert.equal(second.messages[0].input, 99);
  writeFileSync(file, line('a', '2026-10-01') + line('b', '2026-10-02'));
  utimesSync(file, new Date('2030-01-01'), new Date('2030-01-01'));
  const third = readMessages([file], first.cache);
  assert.equal(third.messages.length, 2);
  assert.equal(third.messages[0].input, 1);
});

test('the report sums per day and model and splits around the marker', () => {
  const { messages } = readMessages(transcriptFiles('/tmp/demo-project', HOME));
  const report = usageReport({ messages, prices: prices(), marker: '2026-10-05' });
  assert.equal(report.total.messages, 5);
  assert.equal(report.total.tokens, 103800);
  assert.equal(report.models[0].label, 'Opus 5.5');
  assert.equal(report.models[0].messages, 3);
  assert.deepEqual(report.unpriced, ['claude-unknown-9']);
  assert.equal(report.before.days, 4);
  assert.equal(report.before.messages, 2);
  assert.equal(report.after.messages, 3);
  assert.equal(report.days.find((row) => row.day === '2026-10-06').models['claude-opus-5-5'].messages, 1);
  assert.equal(report.before.cost, 0.14);
  assert.equal(report.after.days, 3);
  assert.match(usageText(report, 'ru'), /До hecpack \(4 дн\.\)/);
  assert.match(usageText(usageReport({ messages: [], prices: prices() })), /No Claude Code transcripts/);
});

test('the marker is the day config.json was added, or nothing without it', () => {
  const project = scratch();
  assert.equal(hecpackMarker(project), undefined);
});

test('the page and report are written outside the project and the page carries the data', () => {
  const out = scratch();
  const result = usage({ project: '/tmp/demo-project', claudeHome: HOME, out, marker: '2026-10-05', lang: 'ru', cache: true, date: '2026-10-08T00:00:00Z' });
  assert.ok(existsSync(result.html));
  assert.ok(existsSync(join(result.dir, 'cache.json')));
  const html = readFileSync(result.html, 'utf8');
  assert.ok(html.includes('"marker":"2026-10-05"'));
  assert.ok(html.includes('"lang":"ru"'));
  assert.ok(!html.includes('/*__REPORT__*/null'));
  assert.equal(JSON.parse(readFileSync(join(result.dir, 'report.json'), 'utf8')).transcripts, 2);
  assert.throws(() => usage({ project: '/tmp/demo-project', claudeHome: HOME }), /--out is required/);
});
