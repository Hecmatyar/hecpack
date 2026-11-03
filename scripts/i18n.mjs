#!/usr/bin/env node
// The translations of hecpack's pages, for the skills. Without --merge it prints, as JSON, what is still to
// translate into a language (key and English text); with --merge it reads {key: translation} as JSON from
// stdin, checks every entry (a known key, the same {placeholders} as the English) and stores the good ones.
//
//   node i18n.mjs --lang <code> --dir <data>/i18n [--pages preview,usage,context]
//   node i18n.mjs --lang <code> --dir <data>/i18n --merge < translations.json

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEnglish, merge, missing, normLang, PAGES } from './lib/i18n.mjs';

export const parseArgs = (argv) => {
  const args = { merge: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--merge') args.merge = true;
    else if (arg.startsWith('--')) {
      const [key, inline] = arg.slice(2).split('=');
      args[key] = inline ?? argv[++i];
    }
  }
  if (!args.dir) throw new Error('--dir is required');
  args.lang = normLang(args.lang);
  args.pages = args.pages ? String(args.pages).split(',').map((page) => page.trim()).filter(Boolean) : PAGES;
  const unknown = args.pages.filter((page) => !PAGES.includes(page));
  if (unknown.length) throw new Error(`unknown page: ${unknown.join(', ')} (known: ${PAGES.join(', ')})`);
  return args;
};

export const status = ({ dir, lang, pages = PAGES }) => {
  const todo = missing({ dir, lang, pages });
  return {
    lang,
    file: isEnglish(lang) ? undefined : join(resolve(dir), `${lang}.json`),
    missing: Object.fromEntries(todo.map((item) => [item.key, item.en])),
    plurals: [...new Set(todo.filter((item) => item.plural).map((item) => item.key.replace(/\.\w+$/, '')))],
    count: todo.length,
    note: todo.length
      ? 'Translate each value into the language, keeping every {placeholder} exactly and the product, command and file names as they are; the keys under each of `plurals` are the plural forms of one phrase, one per number category of the language (.one, .few, .many, .other as Intl.PluralRules names them). Send back {key: translation} as JSON to --merge.'
      : 'Nothing to translate.',
  };
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.merge) {
      const entries = JSON.parse(readFileSync(0, 'utf8'));
      console.log(JSON.stringify(merge({ dir: resolve(args.dir), lang: args.lang, entries }), null, 2));
    } else console.log(JSON.stringify(status({ dir: resolve(args.dir), lang: args.lang, pages: args.pages }), null, 2));
  } catch (error) {
    console.error(`hecpack i18n: ${error.message}`);
    process.exit(1);
  }
}
