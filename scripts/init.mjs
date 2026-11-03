#!/usr/bin/env node
// /hecpack:init: sets a project up at one level. Without --write it only prints the plan (each file with its
// action and diff), so the skill can show it and ask; with --write it writes the files.
//
//   node init.mjs --project <dir> --level lite|standard|deep [--techs id,id] [--rules path,path]
//                 [--modules id,id] [--lang en|ru] [--write] [--force] [--json]
//
// Writing rules: a new file is created; CLAUDE.md gets its hecpack section added or replaced and nothing
// else in it changes; a generated file (.claude/hecpack/*) that exists with other content is kept unless
// --force, so a second run never loses what the user edited there. Settings and permissions are never
// written: they come from the user's own environment.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEVELS, plan } from './lib/plan.mjs';
import { analyze, checkTechs } from './lib/setup.mjs';

const list = (value) => String(value).split(',').map((item) => item.trim()).filter(Boolean);

export const parseArgs = (argv) => {
  const args = { level: undefined, lang: 'en', write: false, force: false, json: false, techs: undefined, rules: [], modules: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (['--write', '--force', '--json'].includes(arg)) args[arg.slice(2)] = true;
    else if (arg.startsWith('--')) {
      const [key, inline] = arg.slice(2).split('=');
      args[key] = inline ?? argv[++i];
    } else if (LEVELS.includes(arg)) args.level = arg;
  }
  if (args.level && !LEVELS.includes(args.level)) throw new Error(`--level must be one of ${LEVELS.join(', ')}`);
  if (args.techs !== undefined) args.techs = list(args.techs);
  args.rules = Array.isArray(args.rules) ? args.rules : list(args.rules);
  args.modules = Array.isArray(args.modules) ? args.modules : list(args.modules);
  return args;
};

const diffText = (path, before, after) => {
  const dir = join(resolve(process.env.TMPDIR ?? '/tmp'), 'hecpack-init-diff');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${process.pid}-${path.replace(/[^\w.-]/g, '_')}`);
  writeFileSync(file, after);
  const result = spawnSync('diff', ['-u', '--label', `a/${path}`, '--label', `b/${path}`, before ?? '/dev/null', file], { encoding: 'utf8' });
  return result.status > 1 ? '' : result.stdout;
};

// Generated files keep the user's edits; CLAUDE.md is a merge of one section, so it is always safe.
const GENERATED = /^\.claude\/hecpack\//;

export const init = (args) => {
  const analysis = analyze(args);
  const { root, detection, sources } = analysis;
  checkTechs(detection, args.techs);
  const level = args.level ?? analysis.recommended.level;
  for (const rule of args.rules) {
    if (!existsSync(join(root, rule))) throw new Error(`rule file not found: ${rule}`);
  }
  const readProject = (path) => (existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : undefined);
  const date = (args.date ?? new Date().toISOString()).slice(0, 10);
  const files = plan({
    detection, sources, level, language: args.lang, techIds: args.techs, rules: args.rules, modules: args.modules, readProject, date,
  }).map((file) => {
    const before = readProject(file.path);
    const kept = file.action === 'update' && GENERATED.test(file.path) && !args.force;
    return {
      ...file,
      diff: file.action === 'same' ? '' : diffText(file.path, before === undefined ? undefined : join(root, file.path), file.content),
      result: file.action === 'same' ? 'same' : kept ? 'kept' : args.write ? 'written' : file.action,
    };
  });
  if (args.write) {
    for (const file of files) {
      if (file.result !== 'written') continue;
      const target = join(root, file.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.content);
    }
  }
  return {
    root,
    level,
    recommended: analysis.recommended,
    techs: (args.techs ?? detection.techs.map((tech) => tech.id)),
    rules: args.rules,
    modules: args.modules,
    written: args.write,
    files: files.map(({ content, ...rest }) => rest),
  };
};

export const summary = (result) => {
  const lines = [
    `hecpack ${result.written ? 'set up' : 'plan for'} ${result.root} at the ${result.level} level${result.level === result.recommended.level ? ' (recommended)' : ` (recommended: ${result.recommended.level})`}.`,
  ];
  for (const file of result.files) {
    const counts = file.result === 'same' ? '' : ` (+${(file.diff.match(/^\+[^+]/gm) ?? []).length}/-${(file.diff.match(/^-[^-]/gm) ?? []).length})`;
    lines.push(`- ${file.result}: ${file.path}${counts}; ${file.note}`);
  }
  const kept = result.files.filter((file) => file.result === 'kept');
  if (kept.length) lines.push(`Kept as they are (edited since generation; --force overwrites): ${kept.map((file) => file.path).join(', ')}.`);
  if (!result.written) lines.push('Nothing was written: run again with --write to apply.');
  return lines.join('\n');
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = init(args);
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(summary(result));
      if (!args.write) for (const file of result.files) if (file.diff) console.log(`\n${file.diff}`);
    }
  } catch (error) {
    console.error(`hecpack init: ${error.message}`);
    process.exit(1);
  }
}
