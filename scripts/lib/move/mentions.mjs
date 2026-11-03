// References to moved paths that are not imports (configs, docs, CLAUDE.md and the project's rules, tool
// settings, path strings in code): listed for the author, never rewritten.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { within } from '../layout.mjs';

const TEXT_FILE = /\.(?:[cm]?[jt]sx?|json|jsonc|md|mdx|ya?ml|toml|html|vue|svelte|astro)$/;
const SKIPPED = /(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|CHANGELOG\.md)$/;

// skip: 'file:line' of the lines the move rewrites. → ['file:line path'] for every other line that names
// one of the paths.
export const findMentions = ({ root, tree, layout, paths, skip = new Set() }) =>
  tree.files
    .filter((file) => TEXT_FILE.test(file) && !SKIPPED.test(file))
    .flatMap((file) => {
      const patterns = paths.flatMap((path) => spellings(layout, path, file).map((spelling) => ({ path, pattern: wordRegExp(spelling) })));
      let text;
      try {
        text = readFileSync(join(root, file), 'utf8');
      } catch {
        return [];
      }
      if (!patterns.some(({ pattern }) => pattern.test(text))) return [];
      return text.split('\n').flatMap((line, i) => {
        if (skip.has(`${file}:${i + 1}`)) return [];
        const found = patterns.find(({ pattern }) => pattern.test(line));
        return found ? [`${file}:${i + 1} ${found.path}`] : [];
      });
    });

// A moved path as other files spell it: from the repo root anywhere, from the package root in that
// package's own files (jest's <rootDir>/src/…, metro's ./src/…).
const spellings = (layout, path, file) => {
  const project = layout.projectOf(path);
  return project !== '.' && within(file, project) ? [path, path.slice(project.length + 1)] : [path];
};

// The path as a whole name: src/card matches ./src/card and src/card.tsx, not src/cards or lib/src/card.
const wordRegExp = (path) => new RegExp(`(?<![\\w-]|[\\w-]/)${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`);
