// Token and money usage of Claude Code in one project, read from the transcripts Claude Code keeps under
// ~/.claude/projects/<project slug>/ (one JSONL per session, subagent runs in <session>/subagents/agent-*.jsonl
// next to an agent-*.meta.json). Every assistant message carries its model and usage; a message streamed in
// several content blocks appears several times with the same id, so messages are counted once by id. Besides
// tokens, each transcript gives the work around them: the user's prompts, compactions, the working time and
// what each model call was for (lib/stages.mjs). The method is the one of the Wayfarer efficiency metrics.
// Read-only.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { bucketOf, callStage, isArchitect } from './stages.mjs';

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

// Working time: a model call from the record before it to its last record, and the tool phase after it up
// to its last tool result; either one longer than CALL_CAP_S was a wait. Questions to the user and the
// agents a call started do not count here: a subagent run counts its own gaps up to RUN_GAP_S, at most
// RUN_CAP_S a run. Time between a reply and the next prompt is never counted.
const CALL_CAP_S = 900;
const RUN_GAP_S = 300;
const RUN_CAP_S = 3600;
const UNTIMED_TOOLS = new Set(['Agent', 'Task', 'SendMessage', 'AskUserQuestion']);
// User records that are not prompts in transcripts older than the `origin` field.
const NOT_PROMPT = /^\s*(<(local-command|system-reminder|task-notification|bash-|user-memory)|\[Request interrupted|Caveat:)/;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const clamp = (seconds) => Math.min(Math.max(0, seconds), CALL_CAP_S);
const textOf = (content) =>
  typeof content === 'string' ? content : Array.isArray(content) ? content.filter((block) => block?.type === 'text').map((block) => block.text ?? '').join('\n') : '';

export const isAgentFile = (file) => basename(file).startsWith('agent-');

// The agent type of a subagent run, from the meta file Claude Code writes next to it.
const agentOf = (file) => {
  try {
    return JSON.parse(readFileSync(file.replace(/\.jsonl$/, '.meta.json'), 'utf8')).agentType || 'subagent';
  } catch {
    return 'subagent';
  }
};

// One transcript: its model calls (records), and per day [prompts, compactions, working seconds]. A main
// session counts only its own records: a fork or a resumed session copies its parent's records with the
// parent's sessionId. A subagent run's records carry its parent's sessionId and all count, to its agent.
export const readTranscript = (file) => {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return { records: [], days: {} };
  }
  const run = isAgentFile(file);
  const name = basename(file, '.jsonl');
  // A transcript whose records never name it (a format before sessionId matched the file) counts whole.
  const own = run || !(text.includes(`"sessionId":"${name}"`) || text.includes(`"sessionId": "${name}"`)) ? undefined : name;
  const agent = run ? agentOf(file) : undefined;
  const calls = new Map();
  const results = new Map();
  const days = {};
  const row = (day) => (days[day] ??= [0, 0, 0]);
  const prompts = { origin: {}, plain: {} };
  let hasOrigin = false;
  let previous = null;
  const times = [];
  for (const line of text.split('\n')) {
    if (!line || !(line.includes('"assistant"') || line.includes('"user"') || line.includes('compact_boundary'))) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // a line cut off by a write in progress; the rest of the file is still valid
    }
    if (own && entry.sessionId && entry.sessionId !== own) continue;
    const ts = entry.timestamp ? Date.parse(entry.timestamp) : NaN;
    const day = String(entry.timestamp ?? '').slice(0, 10);
    if (entry.type === 'assistant') {
      const message = entry.message ?? {};
      // Claude Code writes its own notices (an interrupted turn, an API error) as model `<synthetic>`.
      const id = message.id ?? entry.requestId ?? entry.uuid;
      if (message.usage && message.model && message.model !== '<synthetic>' && id) {
        let call = calls.get(id);
        if (!call) {
          call = { id, day, model: message.model, usage: message.usage, tools: [], start: previous, end: ts };
          calls.set(id, call);
        }
        call.end = ts;
        for (const block of Array.isArray(message.content) ? message.content : []) {
          if (block?.type === 'tool_use') call.tools.push({ id: block.id, name: block.name, input: block.input ?? {} });
        }
      }
    } else if (entry.type === 'user') {
      const content = entry.message?.content;
      const blocks = Array.isArray(content) ? content : [];
      let toolResult = false;
      for (const block of blocks) {
        if (block?.type !== 'tool_result') continue;
        toolResult = true;
        if (!results.has(block.tool_use_id)) results.set(block.tool_use_id, ts);
      }
      if (!toolResult && !run && DAY_RE.test(day)) {
        if (entry.origin) {
          hasOrigin = true;
          if (entry.origin.kind === 'human') prompts.origin[day] = (prompts.origin[day] ?? 0) + 1;
        } else if (!entry.isMeta && !entry.isCompactSummary && textOf(content).trim() && !NOT_PROMPT.test(textOf(content))) {
          prompts.plain[day] = (prompts.plain[day] ?? 0) + 1;
        }
      }
    } else if (entry.type === 'system' && entry.subtype === 'compact_boundary' && DAY_RE.test(day)) {
      row(day)[1] += 1;
    }
    if (Number.isFinite(ts) && (entry.type === 'user' || entry.type === 'assistant')) {
      previous = ts;
      times.push(ts);
    }
  }
  // Transcripts from before the `origin` field: a prompt is a user record that is not a tool result or a notice.
  for (const [day, n] of Object.entries(hasOrigin ? prompts.origin : prompts.plain)) row(day)[0] += n;

  const list = [...calls.values()].filter((call) => DAY_RE.test(call.day));
  if (run) {
    times.sort((a, b) => a - b);
    let total = 0;
    for (let i = 1; i < times.length && total < RUN_CAP_S; i += 1) {
      const gap = Math.min((times[i] - times[i - 1]) / 1000, RUN_CAP_S - total);
      if (gap > RUN_GAP_S) continue;
      total += gap;
      row(dayOf(times[i]))[2] += gap;
    }
  } else {
    for (const call of list) {
      const model = Number.isFinite(call.start) && Number.isFinite(call.end) ? clamp((call.end - call.start) / 1000) : 0;
      const phases = call.tools.filter((tool) => !UNTIMED_TOOLS.has(tool.name) && results.has(tool.id)).map((tool) => clamp((results.get(tool.id) - call.end) / 1000));
      row(call.day)[2] += model + Math.max(0, ...phases);
    }
  }
  for (const value of Object.values(days)) value[2] = Math.round(value[2]);

  const stageOfRun = run ? (isArchitect(agent) ? 'architect' : 'subagent') : undefined;
  const records = list.map((call) => ({
    id: call.id,
    day: call.day,
    model: call.model,
    input: call.usage.input_tokens ?? 0,
    cacheWrite: call.usage.cache_creation_input_tokens ?? 0,
    cacheRead: call.usage.cache_read_input_tokens ?? 0,
    output: call.usage.output_tokens ?? 0,
    stage: stageOfRun ?? callStage(call.tools),
  }));
  return { records, days, agent, runDay: run ? records[0]?.day : undefined };
};

// The usage store: what earlier runs parsed, kept per transcript with its size and mtime. A file that did
// not change is not read again, so a run after the first reads only the sessions since. The store also keeps
// the records of transcripts Claude Code has since removed (it deletes them after `cleanupPeriodDays`, 30 by
// default), so the history outlives them. `from` is the first day the store counts: a new store starts
// `historyDays` back (7 by default; 0 for all the transcripts there are), and every run after keeps it.
// `rebuild` starts the store again with a new window; the records of deleted transcripts stay, as far as
// the window reaches, since they cannot be read again. A store of version 2 (tokens only) is carried over:
// its window and its deleted transcripts stay, the transcripts still there are read again.
export const STORE_VERSION = 3;

// Records are stored as tuples, which keeps a busy month's store at a few megabytes.
const pack = (r) => [r.id, r.day, r.model, r.input, r.cacheWrite, r.cacheRead, r.output, r.stage];
const unpack = ([id, day, model, input, cacheWrite, cacheRead, output, stage = 'unknown'], agent) => ({ id, day, model, input, cacheWrite, cacheRead, output, stage, agent: agent ?? '' });

// A version 2 entry of a deleted transcript: its tokens, with no stage and no work data.
const fromV2 = (file, entry) => {
  const run = isAgentFile(file);
  return { ...entry, records: entry.records.map((tuple) => [...tuple.slice(0, 7), run ? 'subagent' : 'unknown']), days: {}, ...(run ? { agent: 'subagent' } : {}) };
};

export const readMessages = (files, store, { historyDays = 7, now = Date.now(), rebuild = false } = {}) => {
  const known = store?.version === STORE_VERSION ? store : store?.version === 2 ? { ...store, files: Object.fromEntries(Object.entries(store.files ?? {}).filter(([, entry]) => entry.gone).map(([file, entry]) => [file, fromV2(file, entry)])) } : undefined;
  const fresh = !known || rebuild;
  const from = fresh ? (historyDays > 0 ? dayOf(now - (historyDays - 1) * 86400000) : undefined) : known.from;
  const next = { version: STORE_VERSION, from, createdAt: known?.createdAt ?? new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), lang: known?.lang, files: {} };
  const inWindow = (day) => !from || day >= from;
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
    let parsed;
    if (entry && !entry.gone && entry.size === stat.size && entry.mtimeMs === stat.mtimeMs) parsed = entry;
    else if (from && dayOf(stat.mtimeMs) < from) parsed = { records: [], days: {} }; // last written before the window: nothing in it counts
    else {
      const transcript = readTranscript(file);
      parsed = {
        records: transcript.records.filter((record) => inWindow(record.day)).map(pack),
        days: Object.fromEntries(Object.entries(transcript.days).filter(([day]) => inWindow(day))),
        agent: transcript.agent,
        runDay: transcript.runDay && inWindow(transcript.runDay) ? transcript.runDay : undefined,
      };
      read += 1;
    }
    next.files[file] = { size: stat.size, mtimeMs: stat.mtimeMs, records: parsed.records, days: parsed.days ?? {} };
    if (parsed.agent) next.files[file].agent = parsed.agent;
    if (parsed.runDay) next.files[file].runDay = parsed.runDay;
  }
  for (const [file, entry] of Object.entries(known?.files ?? {})) {
    if (current.has(file)) continue;
    const records = entry.records.filter((record) => inWindow(record[1]));
    if (!records.length) continue;
    const days = Object.fromEntries(Object.entries(entry.days ?? {}).filter(([day]) => inWindow(day)));
    next.files[file] = { ...entry, records, days, gone: true };
    if (entry.runDay && !inWindow(entry.runDay)) delete next.files[file].runDay;
  }

  const seen = new Set();
  const messages = [];
  const activity = {};
  const act = (day) => (activity[day] ??= { prompts: 0, compactions: 0, seconds: 0, sessions: 0, runs: {} });
  for (const entry of Object.values(next.files)) {
    for (const tuple of entry.records) {
      if (seen.has(tuple[0])) continue;
      seen.add(tuple[0]);
      messages.push(unpack(tuple, entry.agent));
    }
    for (const [day, [prompts, compactions, seconds]] of Object.entries(entry.days ?? {})) {
      const value = act(day);
      value.prompts += prompts;
      value.compactions += compactions;
      value.seconds += seconds;
    }
    if (entry.agent && entry.runDay) act(entry.runDay).runs[entry.agent] = (act(entry.runDay).runs[entry.agent] ?? 0) + 1;
    // A session counts once, on the first day it has in the window.
    if (!entry.agent && entry.records.length) act(entry.records.reduce((min, tuple) => (tuple[1] < min ? tuple[1] : min), entry.records[0][1])).sessions += 1;
  }
  messages.sort((a, b) => a.day.localeCompare(b.day));
  const gone = Object.values(next.files).filter((entry) => entry.gone).length;
  return { messages, activity, store: next, stats: { firstRun: fresh, from, read, files: current.size, gone, migrated: store?.version === 2 } };
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

const empty = () => ({ input: 0, cacheWrite: 0, cacheRead: 0, output: 0, messages: 0 });
const add = (target, usage) => {
  target.input += usage.input;
  target.cacheWrite += usage.cacheWrite;
  target.cacheRead += usage.cacheRead;
  target.output += usage.output;
  target.messages += 1;
};
const totalTokens = (usage) => usage.input + usage.cacheWrite + usage.cacheRead + usage.output;
const round = (value, digits = 4) => Number(value.toFixed(digits));
const dayDiff = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
const ratio = (value, by) => (by > 0 ? round(value / by, 2) : undefined);

// The usage report: per day and model, per model, and before/after a marker day (the day hecpack was set up).
// Each day's model entry splits its cost by stage, by the context size of main-session calls, and by agent;
// the day carries the work data (prompts, compactions, working seconds, sessions, subagent runs per agent).
export const usageReport = ({ messages, activity = {}, prices, marker, days }) => {
  const since = days ? new Date(Date.now() - days * 86400000).toISOString().slice(0, 10) : undefined;
  const scoped = since ? messages.filter((message) => message.day >= since) : messages;
  const models = {};
  const byDay = {};
  for (const message of scoped) {
    models[message.model] ??= { ...empty(), price: priceFor(message.model, prices) };
    add(models[message.model], message);
    byDay[message.day] ??= {};
    const entry = (byDay[message.day][message.model] ??= { ...empty(), stages: {}, buckets: {}, agents: {} });
    add(entry, message);
    const cost = costOf(message, models[message.model].price) ?? 0;
    const tokens = totalTokens(message);
    entry.stages[message.stage] = (entry.stages[message.stage] ?? 0) + cost;
    const part = message.agent ? (entry.agents[message.agent] ??= { cost: 0, tokens: 0, messages: 0 }) : (entry.buckets[bucketOf(message.input + message.cacheWrite + message.cacheRead)] ??= { cost: 0, tokens: 0, messages: 0 });
    part.cost += cost;
    part.tokens += tokens;
    part.messages += 1;
  }
  const modelRows = Object.entries(models)
    .map(([model, usage]) => ({ model, label: usage.price?.label ?? model, ...usage, tokens: totalTokens(usage), cost: costOf(usage, usage.price), priced: Boolean(usage.price) }))
    .sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0) || b.tokens - a.tokens);
  const dayKeys = [...new Set([...Object.keys(byDay), ...Object.keys(activity).filter((day) => !since || day >= since)])].sort();
  const dayRows = dayKeys.map((day) => {
    const perModel = Object.fromEntries(
      Object.entries(byDay[day] ?? {}).map(([model, usage]) => {
        const roundParts = (parts) => Object.fromEntries(Object.entries(parts).map(([key, value]) => [key, { ...value, cost: round(value.cost) }]));
        return [model, { ...usage, tokens: totalTokens(usage), cost: costOf(usage, models[model].price), stages: Object.fromEntries(Object.entries(usage.stages).map(([key, value]) => [key, round(value)])), buckets: roundParts(usage.buckets), agents: roundParts(usage.agents) }];
      }),
    );
    const values = Object.values(perModel);
    const work = activity[day] ?? { prompts: 0, compactions: 0, seconds: 0, sessions: 0, runs: {} };
    return {
      day,
      models: perModel,
      tokens: values.reduce((sum, item) => sum + item.tokens, 0),
      output: values.reduce((sum, item) => sum + item.output, 0),
      cost: values.reduce((sum, item) => sum + (item.cost ?? 0), 0),
      messages: values.reduce((sum, item) => sum + item.messages, 0),
      prompts: work.prompts,
      compactions: work.compactions,
      seconds: work.seconds,
      sessions: work.sessions,
      runs: work.runs,
    };
  });
  // A period runs over calendar days (from..to), not only the active ones, so the per-day rates compare.
  const period = (rows, from, to) => {
    if (!rows.length) return undefined;
    const span = dayDiff(from, to) + 1;
    const sum = (key) => rows.reduce((acc, row) => acc + row[key], 0);
    const cost = sum('cost');
    const hours = sum('seconds') / 3600;
    const agentCost = rows.reduce((acc, row) => acc + Object.values(row.models).reduce((a, model) => a + Object.values(model.agents).reduce((b, part) => b + part.cost, 0), 0), 0);
    return {
      from,
      to,
      days: span,
      activeDays: rows.filter((row) => row.messages).length,
      tokens: sum('tokens'),
      output: sum('output'),
      cost: round(cost, 2),
      messages: sum('messages'),
      costPerDay: round(cost / span, 2),
      tokensPerDay: Math.round(sum('tokens') / span),
      outputPerMessage: Math.round(sum('output') / Math.max(1, sum('messages'))),
      prompts: sum('prompts'),
      sessions: sum('sessions'),
      compactions: sum('compactions'),
      hours: round(hours, 1),
      costPerHour: ratio(cost, hours),
      costPerPrompt: ratio(cost, sum('prompts')),
      runs: rows.reduce((acc, row) => acc + Object.values(row.runs).reduce((a, n) => a + n, 0), 0),
      subagentShare: cost > 0 ? round(agentCost / cost, 3) : 0,
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
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const total = report.total;
  if (!total) return 'No Claude Code transcripts found for this project.';
  const lines = [`Tokens ${total.from}…${total.to} (${total.activeDays} active days): ${k(total.tokens)} tokens, ${money(total.cost)} at API prices, ${total.messages} model replies.`];
  if (total.hours || total.prompts) {
    lines.push(
      `Work: ${plural(total.prompts, 'prompt')} in ${plural(total.sessions, 'session')}, ${total.hours} working hours; ${total.costPerHour === undefined ? 'no working time' : `${money(total.costPerHour)} per working hour`}, ${total.costPerPrompt === undefined ? 'no prompts' : `${money(total.costPerPrompt)} per prompt`}; ${plural(total.compactions, 'compaction')}; subagents ${Math.round(total.subagentShare * 100)}% of the cost.`,
    );
  }
  for (const row of report.models.slice(0, 6)) {
    lines.push(`- ${row.label}: ${k(row.tokens)} tokens (${k(row.output)} output), ${row.priced ? money(row.cost) : 'no price'}`);
  }
  if (report.before && report.after) {
    const rates = (p) => [p.costPerHour !== undefined && `${money(p.costPerHour)} per working hour`, p.costPerPrompt !== undefined && `${money(p.costPerPrompt)} per prompt`].filter(Boolean).join(', ');
    const side = (p) => `${money(p.costPerDay)} and ${k(p.tokensPerDay)} tokens a day${rates(p) ? `, ${rates(p)}` : ''}`;
    lines.push(`Before hecpack (${report.before.days} days): ${side(report.before)}. After (${report.after.days} days): ${side(report.after)}.`);
  } else if (report.marker) {
    lines.push(`hecpack set up on ${report.marker}; the comparison appears once both sides have data.`);
  }
  if (report.unpriced.length) lines.push(`No price in catalog/prices.json for: ${report.unpriced.join(', ')}.`);
  return lines.join('\n');
};
