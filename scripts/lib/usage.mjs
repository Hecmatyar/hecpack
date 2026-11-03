// Token and money usage of Claude Code in one project, read from the transcripts Claude Code keeps under
// ~/.claude/projects/<project slug>/ (one JSONL per session, subagent transcripts in subfolders). Every
// assistant message carries its model and usage; a message streamed in several content blocks appears
// several times with the same id, so messages are counted once by id. Read-only.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

// Claude Code names a project folder after its path with every non-alphanumeric character replaced by '-'.
export const projectSlug = (root) => resolve(root).replace(/[^a-zA-Z0-9]/g, '-');

const walk = (dir, out) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, out);
    else if (name.endsWith('.jsonl')) out.push(path);
  }
  return out;
};

export const transcriptFiles = (root, claudeHome = join(homedir(), '.claude')) => {
  const dir = join(claudeHome, 'projects', projectSlug(root));
  return existsSync(dir) ? walk(dir, []).sort() : [];
};

// The price row for a model id: the longest key the id starts with (a dated id still matches).
export const priceFor = (model, prices) => {
  const keys = Object.keys(prices.models).filter((key) => model === key || model.startsWith(`${key}-`)).sort((a, b) => b.length - a.length);
  return keys.length ? { id: keys[0], ...prices.models[keys[0]] } : undefined;
};

export const costOf = (usage, price) => {
  if (!price) return undefined;
  const perTok = (perMillion) => perMillion / 1e6;
  return (
    usage.input * perTok(price.input) +
    usage.cacheWrite * perTok(price.cacheWrite ?? price.input * 1.25) +
    usage.cacheRead * perTok(price.cacheRead ?? price.input * 0.1) +
    usage.output * perTok(price.output)
  );
};

const empty = () => ({ input: 0, cacheWrite: 0, cacheRead: 0, output: 0, messages: 0 });
const add = (target, usage) => {
  target.input += usage.input;
  target.cacheWrite += usage.cacheWrite;
  target.cacheRead += usage.cacheRead;
  target.output += usage.output;
  target.messages += 1;
};

// The assistant messages of one transcript: day, model, tokens; a message streamed in several blocks
// appears once (by id).
export const readTranscript = (file) => {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const seen = new Set();
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.includes('"type":"assistant"') && !line.includes('"type": "assistant"')) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    // Claude Code writes its own notices (an interrupted turn, an API error) as model `<synthetic>`.
    if (entry.type !== 'assistant' || !entry.message?.usage || entry.message.model === '<synthetic>') continue;
    const id = entry.message.id ?? entry.requestId ?? entry.uuid;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const usage = entry.message.usage;
    out.push({
      id,
      day: String(entry.timestamp ?? '').slice(0, 10),
      model: entry.message.model ?? 'unknown',
      input: usage.input_tokens ?? 0,
      cacheWrite: usage.cache_creation_input_tokens ?? 0,
      cacheRead: usage.cache_read_input_tokens ?? 0,
      output: usage.output_tokens ?? 0,
    });
  }
  return out.filter((message) => /^\d{4}-\d{2}-\d{2}$/.test(message.day));
};

// The usage store: what earlier runs parsed, kept per transcript with its size and mtime. A file that did
// not change is not read again, so a run after the first reads only the sessions since. The store also keeps
// the records of transcripts Claude Code has since removed (it deletes them after `cleanupPeriodDays`, 30 by
// default), so the history outlives them. `from` is the first day the store counts: a new store starts
// `historyDays` back (7 by default; 0 for all the transcripts there are), and every run after keeps it.
// `rebuild` starts the store again with a new window; the records of deleted transcripts stay, as far as
// the window reaches, since they cannot be read again.
export const STORE_VERSION = 2;

const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

// Records are stored as tuples, which keeps a busy month's store at a few megabytes.
const pack = (r) => [r.id, r.day, r.model, r.input, r.cacheWrite, r.cacheRead, r.output];
const unpack = ([id, day, model, input, cacheWrite, cacheRead, output]) => ({ id, day, model, input, cacheWrite, cacheRead, output });

export const readMessages = (files, store, { historyDays = 7, now = Date.now(), rebuild = false } = {}) => {
  const known = store?.version === STORE_VERSION ? store : undefined;
  const fresh = !known || rebuild;
  const from = fresh ? (historyDays > 0 ? dayOf(now - (historyDays - 1) * 86400000) : undefined) : known.from;
  const next = { version: STORE_VERSION, from, createdAt: known?.createdAt ?? new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), lang: known?.lang, files: {} };
  let read = 0;
  const current = new Set();
  for (const file of files) {
    let stat;
    try {
      stat = statSync(file);
    } catch {
      continue;
    }
    current.add(file);
    const entry = fresh ? undefined : known.files?.[file];
    let records;
    if (entry && !entry.gone && entry.size === stat.size && entry.mtimeMs === stat.mtimeMs) records = entry.records.map(unpack);
    else if (from && dayOf(stat.mtimeMs) < from) records = []; // last written before the window: nothing in it counts
    else {
      records = readTranscript(file).filter((record) => !from || record.day >= from);
      read += 1;
    }
    next.files[file] = { size: stat.size, mtimeMs: stat.mtimeMs, records };
  }
  for (const entry of Object.values(next.files)) entry.records = entry.records.map(pack);
  for (const [file, entry] of Object.entries(known?.files ?? {})) {
    if (current.has(file)) continue;
    const records = entry.records.filter((record) => !from || record[1] >= from);
    if (records.length) next.files[file] = { ...entry, records, gone: true };
  }
  const seen = new Set();
  const messages = [];
  for (const entry of Object.values(next.files)) {
    for (const tuple of entry.records) {
      if (seen.has(tuple[0])) continue;
      seen.add(tuple[0]);
      messages.push(unpack(tuple));
    }
  }
  messages.sort((a, b) => a.day.localeCompare(b.day));
  const gone = Object.values(next.files).filter((entry) => entry.gone).length;
  return { messages, store: next, stats: { firstRun: fresh, from, read, files: current.size, gone } };
};

// The day hecpack was set up in the project: the commit that added .claude/hecpack/config.json, else the
// file's mtime; undefined without the file.
export const hecpackMarker = (root) => {
  const config = join(root, '.claude/hecpack/config.json');
  if (!existsSync(config)) return undefined;
  const result = spawnSync('git', ['-C', root, 'log', '--diff-filter=A', '--format=%cs', '--', '.claude/hecpack/config.json'], { encoding: 'utf8' });
  const added = result.status === 0 ? result.stdout.trim().split('\n').filter(Boolean).at(-1) : undefined;
  return added || statSync(config).mtime.toISOString().slice(0, 10);
};

const totalTokens = (usage) => usage.input + usage.cacheWrite + usage.cacheRead + usage.output;

const dayDiff = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);

// The usage report: per day and model, per model, and before/after a marker day (the day hecpack was set up).
export const usageReport = ({ messages, prices, marker, days }) => {
  const since = days ? new Date(Date.now() - days * 86400000).toISOString().slice(0, 10) : undefined;
  const scoped = since ? messages.filter((message) => message.day >= since) : messages;
  const models = {};
  const byDay = {};
  for (const message of scoped) {
    models[message.model] ??= { ...empty(), price: priceFor(message.model, prices) };
    add(models[message.model], message);
    byDay[message.day] ??= {};
    byDay[message.day][message.model] ??= empty();
    add(byDay[message.day][message.model], message);
  }
  const modelRows = Object.entries(models)
    .map(([model, usage]) => ({ model, label: usage.price?.label ?? model, ...usage, tokens: totalTokens(usage), cost: costOf(usage, usage.price), priced: Boolean(usage.price) }))
    .sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0) || b.tokens - a.tokens);
  const dayRows = Object.keys(byDay).sort().map((day) => {
    const perModel = Object.fromEntries(
      Object.entries(byDay[day]).map(([model, usage]) => [model, { ...usage, tokens: totalTokens(usage), cost: costOf(usage, models[model].price) }]),
    );
    const values = Object.values(perModel);
    return {
      day,
      models: perModel,
      tokens: values.reduce((sum, item) => sum + item.tokens, 0),
      output: values.reduce((sum, item) => sum + item.output, 0),
      cost: values.reduce((sum, item) => sum + (item.cost ?? 0), 0),
      messages: values.reduce((sum, item) => sum + item.messages, 0),
    };
  });
  // A period runs over calendar days (from..to), not only the active ones, so the per-day rates compare.
  const period = (rows, from, to) => {
    if (!rows.length) return undefined;
    const span = dayDiff(from, to) + 1;
    const sum = (key) => rows.reduce((acc, row) => acc + row[key], 0);
    return {
      from,
      to,
      days: span,
      activeDays: rows.length,
      tokens: sum('tokens'),
      output: sum('output'),
      cost: Number(sum('cost').toFixed(2)),
      messages: sum('messages'),
      costPerDay: Number((sum('cost') / span).toFixed(2)),
      tokensPerDay: Math.round(sum('tokens') / span),
      outputPerMessage: Math.round(sum('output') / Math.max(1, sum('messages'))),
    };
  };
  const first = dayRows[0]?.day;
  const last = dayRows.at(-1)?.day;
  const dayBefore = marker ? new Date(Date.parse(marker) - 86400000).toISOString().slice(0, 10) : undefined;
  const before = marker && first && first < marker ? period(dayRows.filter((row) => row.day < marker), first, dayBefore) : undefined;
  const after = marker && last && last >= marker ? period(dayRows.filter((row) => row.day >= marker), marker, last) : undefined;
  return {
    pricesAsOf: prices.asOf,
    since,
    marker,
    total: first ? period(dayRows, first, last) : undefined,
    before,
    after,
    models: modelRows,
    days: dayRows,
    unpriced: modelRows.filter((row) => !row.priced).map((row) => row.model),
  };
};

export const usageText = (report) => {
  const money = (value) => `$${(value ?? 0).toFixed(2)}`;
  const k = (value) => (value >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : value >= 1e3 ? `${Math.round(value / 1e3)}k` : String(Math.round(value)));
  if (!report.total) return 'No Claude Code transcripts found for this project.';
  const lines = [
    `Tokens ${report.total.from}…${report.total.to} (${report.total.activeDays} active days): ${k(report.total.tokens)} tokens, ${money(report.total.cost)} at API prices, ${report.total.messages} model replies.`,
  ];
  for (const row of report.models.slice(0, 6)) {
    lines.push(`- ${row.label}: ${k(row.tokens)} tokens (${k(row.output)} output), ${row.priced ? money(row.cost) : 'no price'}`);
  }
  if (report.before && report.after) {
    lines.push(
      `Before hecpack (${report.before.days} days): ${money(report.before.costPerDay)} and ${k(report.before.tokensPerDay)} tokens a day. After (${report.after.days} days): ${money(report.after.costPerDay)} and ${k(report.after.tokensPerDay)} tokens a day.`,
    );
  } else if (report.marker) {
    lines.push(`hecpack set up on ${report.marker}; the comparison appears once both sides have data.`);
  }
  if (report.unpriced.length) lines.push(`No price in catalog/prices.json for: ${report.unpriced.join(', ')}.`);
  return lines.join('\n');
};
