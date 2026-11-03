import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { costOf, hecpackMarker, priceFor, readMessages, transcriptFiles, usageReport, usageText } from '../scripts/lib/usage.mjs';
import { parseArgs, summary, usage } from '../scripts/usage.mjs';
import { syncPlan } from '../scripts/hooks/usage-sync.mjs';
import { FIXTURES, PLUGIN, scratch } from './helpers.mjs';

const HOME = join(FIXTURES, 'claude-home');
const prices = () => JSON.parse(readFileSync(join(PLUGIN, 'catalog/prices.json'), 'utf8'));

test('arguments', () => {
  const args = parseArgs(['--out', 'x', '--marker', '2026-10-05', '--claude-home', '/h', '--open', '--history-days', 'all', '--rebuild']);
  assert.equal(args.marker, '2026-10-05');
  assert.equal(args.claudeHome, '/h');
  assert.equal(args.open, true);
  assert.equal(args.historyDays, 0);
  assert.equal(args.rebuild, true);
  assert.equal(parseArgs([]).historyDays, 30);
  assert.throws(() => parseArgs(['--history-days', 'month']));
  assert.throws(() => parseArgs(['--marker', 'yesterday']));
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
  const { messages, store } = readMessages(files, undefined, { historyDays: 0 });
  assert.deepEqual(messages.map((message) => message.id), ['m1', 'm2', 'm3', 'm4', 'm5']);
  assert.equal(messages[0].cacheWrite, 20000);
  assert.equal(Object.keys(store.files).length, 2);
  assert.deepEqual(transcriptFiles('/nowhere/at/all', HOME), []);
});

const line = (id, day) => `${JSON.stringify({ type: 'assistant', timestamp: `${day}T00:00:00Z`, message: { id, model: 'claude-sonnet-5-5', usage: { input_tokens: 1, output_tokens: 1 } } })}\n`;
const NOW = Date.parse('2026-11-03T12:00:00Z');

test('the store skips unchanged files and re-reads a changed one', () => {
  const dir = scratch();
  const file = join(dir, 'a.jsonl');
  writeFileSync(file, line('a', '2026-11-01'));
  const first = readMessages([file], undefined, { now: NOW });
  assert.equal(first.stats.firstRun, true);
  first.store.files[file].records[0][3] = 99; // the input count, visible only if the store is used
  const second = readMessages([file], first.store, { now: NOW });
  assert.equal(second.messages[0].input, 99);
  assert.equal(second.stats.read, 0);
  assert.equal(second.stats.firstRun, false);
  writeFileSync(file, line('a', '2026-11-01') + line('b', '2026-11-02'));
  utimesSync(file, new Date('2030-01-01'), new Date('2030-01-01'));
  const third = readMessages([file], first.store, { now: NOW });
  assert.equal(third.messages.length, 2);
  assert.equal(third.messages[0].input, 1);
});

test('a new store counts the last 30 days, keeps that start, and keeps the totals of deleted transcripts', () => {
  const dir = scratch();
  const old = join(dir, 'old.jsonl');
  const mixed = join(dir, 'mixed.jsonl');
  writeFileSync(old, line('o', '2026-09-01'));
  utimesSync(old, new Date('2026-09-01'), new Date('2026-09-01'));
  writeFileSync(mixed, line('m1', '2026-10-01') + line('m2', '2026-10-20'));
  const first = readMessages([old, mixed], undefined, { now: NOW });
  assert.equal(first.store.from, '2026-10-05');
  assert.deepEqual(first.messages.map((m) => m.id), ['m2']);
  assert.equal(first.stats.read, 1, 'a file last written before the window is not read');

  const later = Date.parse('2026-12-20T00:00:00Z');
  const fresh = join(dir, 'new.jsonl');
  writeFileSync(fresh, line('n', '2026-12-19'));
  utimesSync(fresh, new Date('2026-12-19'), new Date('2026-12-19'));
  const second = readMessages([fresh], first.store, { now: later }); // Claude Code deleted the October files
  assert.equal(second.store.from, '2026-10-05');
  assert.deepEqual(second.messages.map((m) => m.id), ['m2', 'n']);
  assert.equal(second.stats.gone, 1);
  assert.equal(second.store.files[mixed].gone, true);

  const all = readMessages([old, mixed], undefined, { now: NOW, historyDays: 0 });
  assert.equal(all.store.from, undefined);
  assert.deepEqual(all.messages.map((m) => m.id), ['o', 'm1', 'm2']);

  const rebuilt = readMessages([fresh], second.store, { now: later, historyDays: 10, rebuild: true });
  assert.equal(rebuilt.store.from, '2026-12-11');
  assert.deepEqual(rebuilt.messages.map((m) => m.id), ['n'], 'deleted records outside the new window drop out');
});

test('the report sums per day and model and splits around the marker', () => {
  const { messages } = readMessages(transcriptFiles('/tmp/demo-project', HOME), undefined, { historyDays: 0 });
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
  assert.match(usageText(report), /Before hecpack \(4 days\)/);
  assert.match(usageText(usageReport({ messages: [], prices: prices() })), /No Claude Code transcripts/);
});

test('the marker is the day config.json was added, or nothing without it', () => {
  const project = scratch();
  assert.equal(hecpackMarker(project), undefined);
});

test('the page and report are written outside the project; the second run reads nothing again', () => {
  const out = scratch();
  const args = { project: '/tmp/demo-project', claudeHome: HOME, out, marker: '2026-10-05', historyDays: 0, date: '2026-10-08T00:00:00Z' };
  const result = usage(args);
  assert.ok(existsSync(result.html));
  assert.ok(existsSync(join(result.dir, 'store.json')));
  assert.equal(result.report.history.firstRun, true);
  assert.match(summary(result), /First count: the whole history/);
  const html = readFileSync(result.html, 'utf8');
  assert.ok(html.includes('"marker":"2026-10-05"'));
  assert.ok(!html.includes('/*__REPORT__*/null'));
  assert.equal(JSON.parse(readFileSync(join(result.dir, 'report.json'), 'utf8')).transcripts, 2);

  const again = usage(args);
  assert.equal(again.stats.read, 0);
  assert.equal(again.report.total.messages, 5);
  assert.throws(() => usage({ project: '/tmp/demo-project', claudeHome: HOME }), /--out is required/);
});

test('the sync hook runs only where hecpack is set up or usage was counted before, and prints nothing', () => {
  const out = scratch();
  const plain = scratch();
  assert.equal(syncPlan({ root: plain, out }), undefined);
  assert.equal(syncPlan({ root: plain, out: '${CLAUDE_PLUGIN_DATA}/usage' }), undefined);
  const setUp = scratch();
  mkdirSync(join(setUp, '.claude/hecpack'), { recursive: true });
  writeFileSync(join(setUp, '.claude/hecpack/config.json'), '{}');
  assert.deepEqual(syncPlan({ root: setUp, out }).slice(1), ['--project', setUp, '--out', out, '--quiet']);
  usage({ project: plain, claudeHome: HOME, out, historyDays: 30 });
  assert.ok(syncPlan({ root: plain, out }));
  const printed = execFileSync('node', [join(PLUGIN, 'scripts/hooks/usage-sync.mjs'), '--out', out], { input: JSON.stringify({ cwd: plain }), env: { ...process.env, CLAUDE_PROJECT_DIR: plain } });
  assert.equal(printed.toString(), '');
});
