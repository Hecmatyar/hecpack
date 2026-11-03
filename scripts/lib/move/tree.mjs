// The files move works over: what git tracks or would track (ignored files are not the project's),
// else a walk that skips dependency and build folders; indexed by folder ('.' is the root).

import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { SKIP_DIRS } from '../detect.mjs';

const isFile = (path) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

// Tracked and untracked files git does not ignore, relative to the root even when it is a subfolder of
// the work tree; a deleted tracked file and a submodule are left out. null outside a work tree.
const gitFiles = (root) => {
  try {
    return execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 1 << 28,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\0')
      .filter((file) => file && isFile(join(root, file)));
  } catch {
    return null;
  }
};

const walkFiles = (root) => {
  const files = [];
  const walk = (dir) => {
    for (const item of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = dir === '.' ? item.name : `${dir}/${item.name}`;
      if (item.isDirectory()) {
        if (!SKIP_DIRS.has(item.name)) walk(path);
      } else if (item.isFile()) {
        files.push(path);
      }
    }
  };
  walk('.');
  return files;
};

export const readTree = (root) => {
  const files = (gitFiles(root) ?? walkFiles(root)).sort();
  const dirs = new Map([['.', { files: [], dirs: [] }]]);
  const folder = (dir) => {
    if (!dirs.has(dir)) {
      dirs.set(dir, { files: [], dirs: [] });
      folder(posix.dirname(dir)).dirs.push(posix.basename(dir));
    }
    return dirs.get(dir);
  };
  for (const file of files) folder(posix.dirname(file)).files.push(posix.basename(file));
  return { files, fileSet: new Set(files), dirs };
};
