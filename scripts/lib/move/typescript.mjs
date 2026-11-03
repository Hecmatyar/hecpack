// The TypeScript compiler API move parses with (syntax only: no program, no type checker), taken from
// the project itself, so hecpack ships no parser. TypeScript 7 (the native compiler) has no JS API; a
// project on it keeps a 6.x or 5.x package for tools (`@typescript/typescript6` and the like).

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';

// Set by loadTypeScript before anything parses.
export let ts;

const NAMES = ['typescript', '@typescript/typescript6', '@typescript/typescript5', '@typescript/old'];

const usable = (module) => typeof module?.createSourceFile === 'function' && typeof module.forEachChild === 'function';

const globalRoot = () => {
  try {
    return execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['root', '-g'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: process.platform === 'win32',
    }).trim();
  } catch {
    return null;
  }
};

// The first that works: HECPACK_TYPESCRIPT (a path to the package), the project's own packages,
// a global install. → the module, or null.
export const loadTypeScript = (root) => {
  const attempts = [];
  if (process.env.HECPACK_TYPESCRIPT) attempts.push(() => createRequire(import.meta.url)(process.env.HECPACK_TYPESCRIPT));
  const fromProject = createRequire(join(root, 'package.json'));
  for (const name of NAMES) attempts.push(() => fromProject(name));
  attempts.push(() => {
    const dir = globalRoot();
    return dir ? createRequire(join(dir, 'noop.js'))('typescript') : null;
  });
  for (const attempt of attempts) {
    try {
      const module = attempt();
      if (usable(module)) {
        ts = module;
        return ts;
      }
    } catch {
      // Not there: the next place.
    }
  }
  return null;
};

export const TYPESCRIPT_MISSING =
  'needs the TypeScript compiler API: none in the project, HECPACK_TYPESCRIPT or a global install. Add it as a dev dependency (npm i -D typescript) or point HECPACK_TYPESCRIPT at a typescript package';
