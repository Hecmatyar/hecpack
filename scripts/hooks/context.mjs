#!/usr/bin/env node
// UserPromptSubmit / SubagentStart / SessionStart: injects the mandatory rules listed in the project's
// .claude/hecpack/context-map.json. A tag in the prompt ([S], [M], [code], [coord], [q], ...) or a subagent's
// name picks the files; an untagged prompt gets the default type plus types whose keywords it contains.
// One hook output is capped at 10,000 chars, so the files are packed into parts and the hook is registered
// once per part (`--part N`); each part computes the layout itself, so the parallel processes never race.
// A project without the context map is not set up by hecpack: the hook stays silent.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN_ROOT = resolve(
  process.env.CLAUDE_PLUGIN_ROOT ??
    fileURLToPath(new URL('../..', import.meta.url)),
);
export const MANIFEST = '.claude/hecpack/context-map.json';
const PLUGIN_PREFIX = 'hecpack:';
// Another session's state files older than a week are removed when any session starts.
const STALE_MS = 7 * 24 * 60 * 60 * 1000;

export const readManifest = (root) =>
  JSON.parse(readFileSync(join(root, MANIFEST), 'utf8'));

// Types the prompt asks for: tags first; without a tag the default type and every type whose keyword
// appears as a whole word (a word is bounded by anything but a letter or digit, so Cyrillic works).
export const promptTypes = (prompt, manifest) => {
  const types = [];
  for (const [, tag] of prompt.matchAll(/\[([a-z0-9-]+)\]/gi)) {
    const type = manifest.tags[tag.toLowerCase()];
    if (type && !types.includes(type)) types.push(type);
  }
  if (types.length) return types;
  const text = prompt.toLowerCase();
  const byWord = Object.entries(manifest.keywords ?? {})
    .filter(([, words]) => words.some((word) => hasWord(text, word)))
    .map(([type]) => type);
  return [
    manifest.untagged,
    ...byWord.filter((type) => type !== manifest.untagged),
  ];
};

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const hasWord = (text, word) =>
  new RegExp(
    `(?<![\\p{L}\\p{N}])${escapeRegExp(word.toLowerCase())}(?![\\p{L}\\p{N}])`,
    'u',
  ).test(text);

// Output parts: the files of the types in order, without repeats and without the `skip` ones.
export const planParts = ({ manifest, specs, skip = [], root }) => {
  const seen = new Set(skip);
  const chunks = [];
  for (const spec of specs) {
    if (seen.has(spec)) continue;
    seen.add(spec);
    for (const text of splitToFit(readSpec(root, spec), manifest.limit - 200)) {
      chunks.push(`=== ${spec} ===\n${text.trim()}\n`);
    }
  }
  const parts = [];
  for (const chunk of chunks) {
    const last = parts.at(-1);
    if (
      last !== undefined &&
      last.length + chunk.length + 1 <= manifest.limit - 200
    ) {
      parts[parts.length - 1] = `${last}\n${chunk}`;
    } else {
      parts.push(chunk);
    }
  }
  return parts;
};

// The text of part `part` (from 1) of `count` registered parts; what did not fit is named in the last one.
export const renderPart = ({ parts, part, count, label }) => {
  const text = parts[part - 1];
  if (text === undefined) return '';
  const head = `Project rules auto-loaded for ${label} (part ${part} of ${Math.min(parts.length, count)}), binding like CLAUDE.md:\n\n`;
  const rest =
    part === count && parts.length > count
      ? `\nMore mandatory rules did not fit the hook parts; read them now: ${parts
          .slice(count)
          .map((extra) => extra.match(/^=== (.+) ===/m)?.[1])
          .join(', ')}\n`
      : '';
  return head + text + rest;
};

export const specsOf = (types, table) =>
  types.flatMap((type) => table[type] ?? []);

// `hecpack:` paths resolve in the plugin, others in the project; `path#Heading` keeps one `## Heading`
// section; a trailing `~top` keeps only unindented lines (a list's top level).
export const resolveSpecPath = (root, path) =>
  path.startsWith(PLUGIN_PREFIX)
    ? join(PLUGIN_ROOT, path.slice(PLUGIN_PREFIX.length))
    : join(root, path);

const readSpec = (root, spec) => {
  const top = spec.endsWith('~top');
  const [path, heading] = (top ? spec.slice(0, -'~top'.length) : spec).split(
    '#',
  );
  let text = readFileSync(resolveSpecPath(root, path), 'utf8');
  if (heading) {
    const start = text.indexOf(`\n## ${heading}\n`);
    if (start === -1) throw new Error(`${spec}: no "## ${heading}" section`);
    const end = text.indexOf('\n## ', start + 1);
    text = text.slice(start + 1, end === -1 ? undefined : end);
  }
  return top
    ? text
        .split('\n')
        .filter((line) => !/^\s/.test(line))
        .join('\n')
    : text;
};

// Splits a text over the limit at headings, then list items, then paragraphs.
const splitToFit = (text, limit) => {
  if (text.length <= limit) return [text];
  for (const separator of ['\n## ', '\n- ', '\n\n']) {
    const pieces = text
      .split(separator)
      .map((piece, index) => (index ? separator.slice(1) + piece : piece));
    if (pieces.length < 2) continue;
    const out = [];
    for (const piece of pieces) {
      const last = out.at(-1);
      if (last !== undefined && last.length + piece.length + 1 <= limit) {
        out[out.length - 1] = `${last}\n${piece}`;
      } else {
        out.push(piece);
      }
    }
    return out.flatMap((piece) =>
      piece.length > limit ? splitToFit(piece, limit) : [piece],
    );
  }
  throw new Error(`a block of ${text.length} chars has no place to split`);
};

const stateDir = (root) =>
  join(
    tmpdir(),
    'hecpack-context',
    createHash('sha1').update(root).digest('hex').slice(0, 12),
  );

const stateFile = (root, session, part) =>
  join(stateDir(root), `${session}.part${part}.json`);

const readDone = (root, session, part) => {
  const file = stateFile(root, session, part);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).types : [];
};

let input;

const main = () => {
  input = JSON.parse(readFileSync(0, 'utf8'));
  const root = resolve(process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? '.');
  if (!existsSync(join(root, MANIFEST))) return;
  const event = input.hook_event_name;
  const session = String(input.session_id ?? 'unknown').replace(/[^\w-]/g, '');

  // After a compaction or clear the injected rules are gone with the history: the next prompt injects them again.
  if (event === 'SessionStart') {
    const dir = stateDir(root);
    if (!existsSync(dir)) return;
    const stale = Date.now() - STALE_MS;
    for (const name of readdirSync(dir)) {
      const file = join(dir, name);
      if (name.startsWith(`${session}.part`) || statSync(file).mtimeMs < stale)
        rmSync(file);
    }
    return;
  }

  const part = Number(process.argv[process.argv.indexOf('--part') + 1]);
  const manifest = readManifest(root);
  let parts;
  let label;
  let count;
  if (event === 'SubagentStart') {
    const specs = manifest.agents?.[input.agent_type];
    if (!specs) return;
    parts = planParts({ manifest, specs, root });
    label = `the ${input.agent_type} agent`;
    count = manifest.parts.agent;
  } else if (event === 'UserPromptSubmit') {
    const done = readDone(root, session, part);
    const types = promptTypes(String(input.prompt ?? ''), manifest).filter(
      (type) => !done.includes(type),
    );
    if (!types.length) return;
    parts = planParts({
      manifest,
      specs: specsOf(types, manifest.types),
      skip: specsOf(done, manifest.types),
      root,
    });
    label = `${types.join(' + ')} work`;
    count = manifest.parts.prompt;
    mkdirSync(stateDir(root), { recursive: true });
    writeFileSync(
      stateFile(root, session, part),
      JSON.stringify({ types: [...done, ...types] }),
    );
  } else {
    return;
  }

  const text = renderPart({ parts, part, count, label });
  if (!text) return;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: event, additionalContext: text },
    }),
  );
};

// A failure never blocks the prompt or the agent, but never passes silently either: the first part tells
// the agent the rules did not load and names the files to read.
export const failureNotice = (message) =>
  `Mandatory project context failed to load (${message}). Before any work, read ${MANIFEST} and the files it lists for this task.`;

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    console.error(`hecpack context hook: ${error.message}`);
    const event = input?.hook_event_name;
    const part = Number(process.argv[process.argv.indexOf('--part') + 1]);
    if (
      (event === 'UserPromptSubmit' || event === 'SubagentStart') &&
      part === 1
    ) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: event,
            additionalContext: failureNotice(error.message),
          },
        }),
      );
    }
  }
}
