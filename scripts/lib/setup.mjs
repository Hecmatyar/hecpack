// What /preview, /init and the scan share: reading the project, finding the sources, recommending a level
// and the plugins worth installing. Nothing here writes.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detect } from './detect.mjs';
import { summarizeLayout } from './layout.mjs';
import { agentsFor, recommendLevel, warnings } from './plan.mjs';
import { audit } from './audit.mjs';
import { findSources, readEnabled, readMarketplaces } from './sources.mjs';

export const PLUGIN_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
export const pluginVersion = () => readJson(join(PLUGIN_ROOT, '.claude-plugin/plugin.json')).version;

export const analyze = ({ project, claudeHome, level }) => {
  const root = resolve(project ?? process.cwd());
  const catalog = readJson(join(PLUGIN_ROOT, 'catalog/technologies.json'));
  const { packs } = readJson(join(PLUGIN_ROOT, 'catalog/packs.json'));
  const detection = detect(root, catalog);
  const plugins = readMarketplaces(claudeHome);
  const enabled = readEnabled(claudeHome, detection.claude.enabledPlugins);
  const sources = findSources({ techs: detection.techs, packs, plugins, enabled, mcp: detection.claude.mcp });
  const bySource = Object.fromEntries(sources.map((item) => [item.tech, item.sources]));
  // Plugins to propose: one named after a technology, official, not on yet.
  const suggested = [];
  for (const tech of detection.techs) {
    for (const source of bySource[tech.id] ?? []) {
      if (source.kind === 'plugin' && source.primary && source.tier === 'official' && !source.enabled && !suggested.some((item) => item.id === source.id)) {
        suggested.push({ id: source.id, label: source.label, for: tech.label, install: source.install, description: source.description });
      }
    }
  }
  const recommended = recommendLevel(detection);
  return {
    root,
    detection,
    sources,
    bySource,
    recommended,
    // What is installed around the project, against what hecpack would add at the chosen (else the
    // recommended) level, before anything is left out.
    audit: audit({ root, claudeHome, pluginRoot: PLUGIN_ROOT, agentList: agentsFor(level ?? recommended.level, detection.techs) }),
    suggestedPlugins: suggested,
    warnings: warnings(detection.claude),
  };
};

export const checkTechs = (detection, techIds) => {
  const unknown = (techIds ?? []).filter((id) => !detection.techs.some((tech) => tech.id === id));
  if (unknown.length) throw new Error(`not found in this project: ${unknown.join(', ')}`);
};

// The compact JSON the skills read before they ask the user anything.
export const scanSummary = (analysis) => {
  const { detection, bySource, recommended, suggestedPlugins, warnings: warn, audit: installed } = analysis;
  return {
    hecpack: pluginVersion(),
    project: { name: detection.name, root: analysis.root, packageManager: detection.packageManager, workspaces: detection.workspaces },
    techs: detection.techs.map((tech) => ({
      id: tech.id,
      label: tech.label,
      kind: tech.kind,
      version: tech.version,
      sources: (bySource[tech.id] ?? []).map((source) => `${source.kind}:${source.id}${source.enabled ? ' (on)' : ''}`),
    })),
    validation: detection.validation.map((item) => item.command),
    recommended,
    suggestedPlugins,
    claude: detection.claude,
    docs: detection.docs,
    layout: summarizeLayout(detection.layout),
    audit: installed,
    warnings: warn,
  };
};
