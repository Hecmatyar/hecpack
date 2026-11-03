// Where the rules and know-how for each detected technology can come from, best first: a hecpack pack,
// plugins in the marketplaces this Claude Code already knows (official before community), the current docs
// through context7, and as the fallback a local skill /init would write from those docs.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const OFFICIAL = new Set(['claude-plugins-official']);
const MAX_PER_TECH = 3;

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
};

// Every plugin entry of every marketplace Claude Code has added, read from its local copy.
export const readMarketplaces = (claudeHome = join(homedir(), '.claude')) => {
  const known = readJson(join(claudeHome, 'plugins/known_marketplaces.json')) ?? {};
  const entries = [];
  for (const [marketplace, info] of Object.entries(known)) {
    const catalog = info?.installLocation && readJson(join(info.installLocation, '.claude-plugin/marketplace.json'));
    for (const plugin of catalog?.plugins ?? []) {
      entries.push({
        marketplace,
        name: plugin.name,
        description: plugin.description ?? '',
        category: plugin.category,
        homepage: plugin.homepage ?? plugin.repository,
        tier: OFFICIAL.has(marketplace) ? 'official' : 'community',
      });
    }
  }
  return entries;
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

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasWord = (text, word) =>
  new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(word.toLowerCase())}(?![\\p{L}\\p{N}])`, 'u').test(text.toLowerCase());

// A plugin named after the technology is a strong match; one that only mentions it is weak and needs a
// word long enough not to be an everyday word ("go", "nest" are left to names only).
export const matchPlugins = (tech, plugins) => {
  const scored = [];
  for (const plugin of plugins) {
    const nameWords = plugin.name.toLowerCase().split(/[-_.\s]+/);
    const strong = tech.search.some((word) =>
      word.includes(' ') ? plugin.name.toLowerCase().includes(word.replace(/\s+/g, '-')) : nameWords.includes(word.toLowerCase()),
    );
    const weak =
      !strong &&
      tech.search.some((word) => word.length >= 5 && hasWord(plugin.description, word)) &&
      hasWord(plugin.description, tech.label.split(/[\s/]+/)[0]);
    if (strong || weak) {
      // Primary: the plugin's name starts with the technology's word (expo, typescript-lsp), not ui5-typescript-….
      const primary = strong && tech.search.some((word) => nameWords[0] === word.toLowerCase().split(/\s+/)[0]);
      scored.push({ ...plugin, primary, match: strong ? 'name' : 'description', score: (strong ? 10 : 1) + (plugin.tier === 'official' ? 2 : 0) });
    }
  }
  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  // Mentions are noisy: one is shown only when no plugin is named after the technology.
  const strong = scored.filter((plugin) => plugin.match === 'name');
  return (strong.length ? strong : scored.slice(0, 1)).slice(0, MAX_PER_TECH);
};

export const findSources = ({ techs, packs, plugins, enabled, mcp = [] }) => {
  const context7 =
    mcp.includes('context7') || [...enabled].some((id) => id.split('@')[0] === 'context7');
  return techs.map((tech) => {
    const sources = [];
    const pack = packs.find((item) => item.techs.includes(tech.id));
    if (pack) {
      sources.push({ kind: 'pack', id: pack.id, label: `hecpack ${pack.label}`, status: pack.status, description: pack.description });
    }
    for (const plugin of matchPlugins(tech, plugins)) {
      const id = `${plugin.name}@${plugin.marketplace}`;
      sources.push({
        kind: 'plugin',
        id,
        label: plugin.name,
        tier: plugin.tier,
        match: plugin.match,
        primary: plugin.primary,
        description: plugin.description,
        homepage: plugin.homepage,
        enabled: enabled.has(id),
        install: `claude plugin install ${id}`,
      });
    }
    if (tech.docs === 'context7') {
      sources.push({ kind: 'docs', id: 'context7', label: 'context7 (current docs)', enabled: context7 });
    }
    const covered = sources.some((source) => source.kind === 'pack' || (source.kind === 'plugin' && source.match === 'name'));
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
