#!/usr/bin/env node
// What is in the project, as JSON: technologies with their sources, validation commands, the recommended
// level, the plugins worth installing, the Claude setup and the rule documents already there. Read-only;
// the /init and /preview skills run it before they ask the user anything.
//
//   node scan.mjs --project <dir>

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze, scanSummary } from './lib/setup.mjs';

export const parseArgs = (argv) => {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const [key, inline] = arg.slice(2).split('=');
      args[key] = inline ?? argv[++i];
    }
  }
  return args;
};

export const scan = (args) => scanSummary(analyze(args));

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(scan(parseArgs(process.argv.slice(2))), null, 2));
  } catch (error) {
    console.error(`hecpack scan: ${error.message}`);
    process.exit(1);
  }
}
