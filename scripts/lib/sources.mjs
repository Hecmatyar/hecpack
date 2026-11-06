// Where the rules and know-how for each detected technology come from, best first: a hecpack pack, a
// plugin the user already has on that is named after the technology (a fact about the setup, never a
// suggestion), the current docs through context7, and as the fallback a local skill /init would write
// from those docs. Nothing is looked up in the marketplaces: hecpack proposes only what it ships itself,
// and a plugin matched by a word in its name (ui5-typescript-… for TypeScript) was noise.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
};

// Plugins already on: installed for the user, or enabled in the user's or the project's settings.
export const readEnabled = (claudeHome = join(homedir(), '.claude'), projectEnabled = {}) => {
  const enabled = new Set();
  const installed = readJson(join(claudeHome, 'plugins/installed_plugins.json'))?.plugins ?? {};
  for (const id of Object.keys(installed)) enabled.add(id);
  const user = readJson(join(claudeHome, 'settings.json'))?.enabledPlugins ?? {};
  for (const [id, on] of Object.entries({ ...user, ...projectEnabled })) if (on) enabled.add(id);
  return enabled;
};

// An enabled plugin counts for a technology only when its name starts with the technology's word
// (expo@…, typescript-lsp@…), not when the word sits inside it (ui5-typescript-conversion@…).
export const enabledFor = (tech, enabled) => {
  const firstWords = tech.search.map((word) => word.toLowerCase().split(/\s+/)[0]);
  return [...enabled].filter((id) => firstWords.includes(id.split('@')[0].toLowerCase().split(/[-_.]/)[0])).sort();
};

export const findSources = ({ techs, packs, enabled = new Set(), mcp = [] }) => {
  const context7 =
    mcp.includes('context7') || [...enabled].some((id) => id.split('@')[0] === 'context7');
  return techs.map((tech) => {
    const sources = [];
    const pack = packs.find((item) => item.techs.includes(tech.id));
    if (pack) {
      sources.push({ kind: 'pack', id: pack.id, label: `hecpack ${pack.label}`, status: pack.status, description: pack.description });
    }
    for (const id of enabledFor(tech, enabled)) {
      sources.push({ kind: 'plugin', id, label: id.split('@')[0], enabled: true });
    }
    if (tech.docs === 'context7') {
      sources.push({ kind: 'docs', id: 'context7', label: 'context7 (current docs)', enabled: context7 });
    }
    const covered = sources.some((source) => source.kind === 'pack' || source.kind === 'plugin');
    // Checks and docs need no skill of their own; rules for UI, platform, data or structure do.
    const needsRules = tech.covers.some((slot) => slot !== 'validation' && slot !== 'docs');
    if (!covered && needsRules) {
      sources.push({
        kind: 'local-skill',
        id: `.claude/skills/${tech.id}`,
        label: `Local skill ${tech.id}`,
        description: `/init writes .claude/skills/${tech.id}/SKILL.md from the ${tech.label}${tech.version ? ` ${tech.version}` : ''} docs and this project's own code.`,
      });
    }
    return { tech: tech.id, sources };
  });
};
