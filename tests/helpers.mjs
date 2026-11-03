import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURES = fileURLToPath(new URL('./fixtures', import.meta.url));
export const PLUGIN = fileURLToPath(new URL('..', import.meta.url));
export const catalog = () => JSON.parse(readFileSync(join(PLUGIN, 'catalog/technologies.json'), 'utf8'));
export const packs = () => JSON.parse(readFileSync(join(PLUGIN, 'catalog/packs.json'), 'utf8')).packs;
export const scratch = () => mkdtempSync(join(tmpdir(), 'hecpack-test-'));

// A Claude home with one marketplace, its catalog at an absolute path as Claude Code records it.
export const claudeHome = () => {
  const home = scratch();
  cpSync(join(FIXTURES, 'claude-home'), home, { recursive: true });
  writeFileSync(
    join(home, 'plugins/known_marketplaces.json'),
    JSON.stringify({ 'claude-plugins-official': { installLocation: join(home, 'market') } }),
  );
  return home;
};
