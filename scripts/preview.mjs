#!/usr/bin/env node
// /hecpack:preview: what /init would set up in a project, shown on a local page, with nothing written into
// the project. Detects the stack, finds sources for each technology, plans the files for every level and
// writes them, their diffs against the project, report.json and index.html into its own folder.
//
//   node preview.mjs --project <dir> --out <dir> [--level lite|standard|deep] [--lang <code>]
//                    [--techs id,id] [--without designer,e2e-runner] [--try] [--open]
//
// --try also clones the project's committed state (git clone --local) next to the report and writes the
// files of the chosen level there, so the setup can be tried in a throwaway copy.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentIds, agentsFor, LEVEL_INFO, LEVELS, MODULES, plan } from './lib/plan.mjs';
import { auditText } from './lib/audit.mjs';
import { analyze, checkTechs, PLUGIN_ROOT, pluginVersion } from './lib/setup.mjs';

export const parseArgs = (argv) => {
  const args = { level: undefined, lang: 'en', try: false, open: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--try' || arg === '--open') args[arg.slice(2)] = true;
    else if (arg.startsWith('--')) {
      const [key, inline] = arg.slice(2).split('=');
      args[key] = inline ?? argv[++i];
    } else if (LEVELS.includes(arg)) args.level = arg;
  }
  if (args.level && !LEVELS.includes(args.level)) throw new Error(`--level must be one of ${LEVELS.join(', ')}`);
  if (args.techs) args.techs = String(args.techs).split(',').map((id) => id.trim()).filter(Boolean);
  args.without = agentIds(args.without ? String(args.without).split(',').map((id) => id.trim()).filter(Boolean) : []);
  return args;
};

const diffOf = (path, before, after) => {
  const result = spawnSync('diff', ['-u', '--label', `a/${path}`, '--label', `b/${path}`, before ?? '/dev/null', after], {
    encoding: 'utf8',
  });
  if (result.status > 1) throw new Error(`diff failed for ${path}: ${result.stderr}`);
  return result.stdout;
};

const countLines = (diff) => {
  let added = 0;
  let removed = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) added += 1;
    else if (line.startsWith('-') && !line.startsWith('---')) removed += 1;
  }
  return { added, removed };
};

// The page reads the report from an inline script; `</` would close it early.
const page = (report) =>
  readFileSync(join(PLUGIN_ROOT, 'scripts/preview-page.html'), 'utf8').replace(
    '/*__REPORT__*/null',
    () => JSON.stringify(report).replace(/</g, '\\u003c'),
  );

const openFile = (file) => {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  spawnSync(opener, [file], { stdio: 'ignore' });
};

export const preview = (args) => {
  const analysis = analyze(args);
  const { root, detection, sources, bySource } = analysis;
  const version = pluginVersion();
  checkTechs(detection, args.techs);
  const level = args.level ?? analysis.recommended.level;

  const slug = `${basename(root)}-${createHash('sha1').update(root).digest('hex').slice(0, 6)}`;
  const out = join(resolve(args.out), slug);
  // Only a folder this script made earlier (it holds report.json) is cleared.
  if (existsSync(join(out, 'report.json'))) rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  const date = (args.date ?? new Date().toISOString()).slice(0, 10);
  const readProject = (path) => (existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : undefined);
  const levels = {};
  for (const level of LEVELS) {
    // Every optional module is planned too; the page shows them unticked and /init takes --modules.
    const files = plan({ detection, sources, level, language: args.lang, techIds: args.techs, modules: Object.keys(MODULES), without: args.without, readProject, date });
    const chosenTechs = args.techs ? detection.techs.filter((tech) => args.techs.includes(tech.id)) : detection.techs;
    levels[level] = {
      info: LEVEL_INFO[level],
      agents: agentsFor(level, chosenTechs),
      files: files.map((file) => {
        const target = join(out, level, 'files', file.path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, file.content);
        const diff = diffOf(file.path, existsSync(join(root, file.path)) ? join(root, file.path) : undefined, target);
        return { path: file.path, note: file.note, action: file.action, module: file.module, content: file.content, diff, ...countLines(diff) };
      }),
    };
  }

  let sandbox;
  if (args.try) {
    sandbox = join(out, 'sandbox');
    const clone = spawnSync('git', ['clone', '--local', '--quiet', root, sandbox], { encoding: 'utf8' });
    if (clone.status !== 0) throw new Error(`git clone failed: ${clone.stderr.trim()}`);
    for (const file of levels[level].files) {
      if (file.module) continue;
      const target = join(sandbox, file.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.content);
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    hecpack: version,
    lang: args.lang,
    project: {
      name: detection.name,
      root,
      packageManager: detection.packageManager,
      workspaces: detection.workspaces,
    },
    selection: { level, techs: args.techs ?? detection.techs.map((tech) => tech.id), without: args.without },
    recommended: analysis.recommended,
    suggestedPlugins: analysis.suggestedPlugins,
    modules: MODULES,
    docs: detection.docs,
    audit: analysis.audit,
    techs: detection.techs.map((tech) => ({
      id: tech.id,
      label: tech.label,
      kind: tech.kind,
      version: tech.version,
      evidence: tech.evidence,
      covers: tech.covers,
      sources: bySource[tech.id] ?? [],
    })),
    validation: detection.validation,
    e2e: detection.e2e,
    claude: detection.claude,
    warnings: analysis.warnings,
    levels,
    paths: { out, page: join(out, 'index.html'), sandbox },
  };
  writeFileSync(join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(out, 'index.html'), page(report));
  return report;
};

// A short text for the skill to retell; the page has the rest.
export const summary = (report) => {
  const level = report.levels[report.selection.level];
  const lines = [
    `hecpack ${report.hecpack} preview of ${report.project.name} (${report.project.root}); nothing in the project was changed.`,
    `Technologies (${report.techs.length}): ${report.techs.map((tech) => `${tech.label}${tech.version ? ` ${tech.version}` : ''}`).join(', ')}.`,
    `Validation: ${report.validation.map((item) => `\`${item.command}\``).join('; ') || 'none found'}.`,
    `Level ${report.selection.level}${report.selection.level === report.recommended.level ? ' (recommended)' : ` (recommended: ${report.recommended.level}, ${report.recommended.reason})`}: ${level.files.filter((file) => !file.module).map((file) => `${file.action} ${file.path} (+${file.added}/-${file.removed})`).join('; ')}.`,
    `Agents at this level: ${level.agents.join(', ')}.`,
    `E2E: ${report.e2e.map((item) => `\`${item.command}\``).join('; ') || 'no suite found (stack.md suggests one)'}.`,
    `Optional modules: ${level.files.filter((file) => file.module).map((file) => `${file.module} -> ${file.path}`).join('; ') || 'none'}.`,
    `Rule documents already in the project (${report.docs.length}): ${report.docs.map((doc) => doc.path).join(', ') || 'none'}.`,
  ];
  for (const tech of report.techs) {
    const named = tech.sources.filter((source) => source.kind !== 'docs').map((source) => `${source.kind} ${source.id}${source.enabled ? ' (on)' : ''}`);
    if (named.length) lines.push(`- ${tech.label}: ${named.join(', ')}`);
  }
  for (const warning of report.warnings) lines.push(`Warning: ${warning.text}`);
  lines.push(auditText(report.audit));
  lines.push(`Page: ${report.paths.page}`);
  if (report.paths.sandbox) lines.push(`Sandbox with the ${report.selection.level} files: ${report.paths.sandbox}`);
  return lines.join('\n');
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (!args.out) throw new Error('--out is required');
    const report = preview(args);
    if (args.open) openFile(report.paths.page);
    console.log(summary(report));
  } catch (error) {
    console.error(`hecpack preview: ${error.message}`);
    process.exit(1);
  }
}
