import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { costOf, hecpackMarker, priceFor, readMessages, readTranscript, STORE_VERSION, transcriptFiles, usageReport, usageText } from '../scripts/lib/usage.mjs';
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
  assert.equal(parseArgs([]).historyDays, 7);
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

test('a new store counts the last 7 days, keeps that start, and keeps the totals of deleted transcripts', () => {
  const dir = scratch();
  const old = join(dir, 'old.jsonl');
  const mixed = join(dir, 'mixed.jsonl');
  writeFileSync(old, line('o', '2026-09-01'));
  utimesSync(old, new Date('2026-09-01'), new Date('2026-09-01'));
  writeFileSync(mixed, line('m1', '2026-10-01') + line('m2', '2026-10-30'));
  const first = readMessages([old, mixed], undefined, { now: NOW });
  assert.equal(first.store.from, '2026-10-28');
  assert.deepEqual(first.messages.map((m) => m.id), ['m2']);
  assert.equal(first.stats.read, 1, 'a file last written before the window is not read');

  const later = Date.parse('2026-12-20T00:00:00Z');
  const fresh = join(dir, 'new.jsonl');
  writeFileSync(fresh, line('n', '2026-12-19'));
  utimesSync(fresh, new Date('2026-12-19'), new Date('2026-12-19'));
  const second = readMessages([fresh], first.store, { now: later }); // Claude Code deleted the October files
  assert.equal(second.store.from, '2026-10-28');
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

const WORK = join(HOME, 'projects/-tmp-work-project');

test('a session gives its prompts, compactions and working time; a fork copy and a notice do not count', () => {
  const main = readTranscript(join(WORK, 'w1.jsonl'));
  assert.deepEqual(main.records.map((r) => `${r.id}:${r.stage}`), ['c1:explore', 'c2:edit', 'c3:validate', 'c4:architect', 'c5:answer', 'c6:service', 'c7:answer']);
  // 2 prompts (not the fork's, the meta record or the task notification), 1 compaction; time: model time
  // and tool runs, without the architect's run (counted in its own file) and the wait for the answer.
  assert.deepEqual(main.days, { '2026-10-20': [2, 1, 180] });
  assert.equal(main.agent, undefined);
  const run = readTranscript(join(WORK, 'w1/subagents/agent-x.jsonl'));
  assert.deepEqual(run.records.map((r) => `${r.id}:${r.stage}`), ['a1:architect', 'a2:architect']);
  assert.equal(run.agent, 'hecpack:architect');
  assert.deepEqual(run.days, { '2026-10-20': [0, 0, 155] }, 'its own record gaps, its prompt is not the user\'s');
});

test('the report gives the cost of a working hour and of a prompt, and splits by stage, context and agent', () => {
  const { messages, activity } = readMessages(transcriptFiles('/tmp/work-project', HOME), undefined, { historyDays: 0 });
  assert.deepEqual(activity['2026-10-20'], { prompts: 2, compactions: 1, seconds: 335, sessions: 1, runs: { 'hecpack:architect': 1 } });
  const report = usageReport({ messages, activity, prices: prices() });
  const total = report.total;
  assert.equal(total.prompts, 2);
  assert.equal(total.sessions, 1);
  assert.equal(total.runs, 1);
  assert.equal(total.hours, 0.1);
  const cost = report.days[0].cost;
  assert.equal(total.costPerHour, Number((cost / (335 / 3600)).toFixed(2)));
  assert.equal(total.costPerPrompt, Number((cost / 2).toFixed(2)));
  assert.ok(total.subagentShare > 0 && total.subagentShare < 1);
  const opus = report.days[0].models['claude-opus-5-5'];
  assert.deepEqual(Object.keys(opus.stages).sort(), ['answer', 'architect', 'edit', 'explore', 'service', 'validate']);
  assert.equal(opus.buckets['200to300k'].messages, 1);
  assert.equal(opus.buckets.lt100k.messages, 6);
  assert.deepEqual(Object.keys(report.days[0].models['claude-sonnet-5-5'].agents), ['hecpack:architect']);
  assert.match(usageText(report), /Work: 2 prompts in 1 session, 0\.1 working hours; \$[\d.]+ per working hour, \$[\d.]+ per prompt; 1 compaction; subagents \d+% of the cost\./);
});

test('a version 2 store keeps its window and deleted transcripts, and reads the others again', () => {
  const files = transcriptFiles('/tmp/work-project', HOME);
  const v2 = {
    version: 2,
    from: '2026-10-15',
    createdAt: '2026-10-15T00:00:00.000Z',
    lang: 'ru',
    files: {
      [files[0]]: { size: 1, mtimeMs: 1, records: [['c1', '2026-10-20', 'claude-opus-5-5', 1, 0, 0, 1]] },
      '/gone/s0.jsonl': { size: 1, mtimeMs: 1, gone: true, records: [['g1', '2026-10-16', 'claude-opus-5-5', 1000, 0, 0, 100]] },
      '/gone/s0/subagents/agent-q.jsonl': { size: 1, mtimeMs: 1, gone: true, records: [['g2', '2026-10-16', 'claude-opus-5-5', 1000, 0, 0, 100]] },
    },
  };
  const { messages, store, stats } = readMessages(files, v2, { now: Date.parse('2026-10-21T00:00:00Z') });
  assert.equal(store.version, STORE_VERSION);
  assert.equal(store.from, '2026-10-15');
  assert.equal(store.lang, 'ru');
  assert.equal(stats.migrated, true);
  assert.equal(stats.firstRun, false);
  assert.equal(stats.read, 2);
  assert.equal(messages.find((m) => m.id === 'g1').stage, 'unknown');
  assert.equal(messages.find((m) => m.id === 'g2').agent, 'subagent');
  assert.equal(messages.find((m) => m.id === 'c1').stage, 'explore');
  assert.equal(messages.filter((m) => m.id === 'c1').length, 1);
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
