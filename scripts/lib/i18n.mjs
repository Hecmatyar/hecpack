// The strings of hecpack's pages in the user's language. English lives in scripts/i18n/en.json and is the
// source; a translation is a flat file <dir>/<lang>.json in the plugin's data folder, written once by the
// skill (the model translates what is missing, scripts/i18n.mjs checks and stores it) and reused by every
// later page, including the ones the usage hook builds in the background. A key the translation lacks, or
// one whose English changed since, falls back to English on the page and shows up as missing.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EN = JSON.parse(readFileSync(fileURLToPath(new URL('../i18n/en.json', import.meta.url)), 'utf8'));
export const PAGES = ['preview', 'usage', 'context'];

const CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'];
const isPlural = (value) => value && typeof value === 'object' && 'other' in value && Object.keys(value).every((key) => CATEGORIES.includes(key));

export const fill = (text, values = {}) => String(text).replace(/\{(\w+)\}/g, (match, key) => (key in values ? String(values[key]) : match));
const placeholders = (text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
const hash = (text) => createHash('sha1').update(text).digest('hex').slice(0, 10);

// A language code as Intl knows it: `ru`, `pt-BR`, `zh-Hant`. English variants need no translation.
export const normLang = (code = 'en') => {
  const value = String(code).trim();
  if (!/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(value)) throw new Error(`--lang must be a language code such as en, de or pt-BR, not ${value}`);
  const [canonical] = Intl.getCanonicalLocales(value);
  return canonical;
};
export const isEnglish = (lang) => /^en(-|$)/i.test(lang);

const pluralCategories = (lang) => new Intl.PluralRules(lang).resolvedOptions().pluralCategories;

// Every string a page needs in `lang`, flat: `usage.title`, and for a plural one key per category the
// language uses (`usage.days.few` in Russian), with the English to translate from.
export const needed = (lang, pages = PAGES) => {
  const out = [];
  const walk = (node, prefix) => {
    for (const [key, value] of Object.entries(node)) {
      const path = `${prefix}.${key}`;
      if (typeof value === 'string') out.push({ key: path, en: value, source: hash(value) });
      else if (isPlural(value)) {
        const source = hash(JSON.stringify(value));
        for (const category of pluralCategories(lang)) out.push({ key: `${path}.${category}`, en: value[category] ?? value.other, source, plural: true });
      } else if (value && typeof value === 'object') walk(value, path);
    }
  };
  for (const page of pages) walk(EN[page], page);
  return out;
};

const fileOf = (dir, lang) => join(dir, `${lang}.json`);

export const readTranslation = (dir, lang) => {
  try {
    const json = JSON.parse(readFileSync(fileOf(dir, lang), 'utf8'));
    return { strings: json.strings ?? {}, source: json.source ?? {} };
  } catch {
    return { strings: {}, source: {} };
  }
};

// What is still to translate: keys with no translation, or whose English changed since it was translated.
export const missing = ({ dir, lang, pages = PAGES }) => {
  if (isEnglish(lang)) return [];
  const { strings, source } = readTranslation(dir, lang);
  return needed(lang, pages).filter((item) => strings[item.key] === undefined || source[item.key] !== item.source);
};

// Stores translations, each checked: a known key, a string, the same placeholders as the English.
export const merge = ({ dir, lang, entries }) => {
  if (isEnglish(lang)) throw new Error('English needs no translation');
  const want = new Map(needed(lang).map((item) => [item.key, item]));
  const current = readTranslation(dir, lang);
  const written = [];
  const rejected = [];
  for (const [key, text] of Object.entries(entries ?? {})) {
    const item = want.get(key);
    if (!item) rejected.push({ key, reason: 'unknown key' });
    else if (typeof text !== 'string' || !text.trim()) rejected.push({ key, reason: 'not a string' });
    else if (placeholders(text).join() !== placeholders(item.en).join()) {
      rejected.push({ key, reason: `placeholders must be ${placeholders(item.en).map((name) => `{${name}}`).join(' ') || 'none'}` });
    } else {
      current.strings[key] = text;
      current.source[key] = item.source;
      written.push(key);
    }
  }
  if (written.length) {
    mkdirSync(dir, { recursive: true });
    const sorted = (object) => Object.fromEntries(Object.keys(object).sort().map((key) => [key, object[key]]));
    const temp = `${fileOf(dir, lang)}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify({ lang, strings: sorted(current.strings), source: sorted(current.source) }, null, 2)}\n`);
    renameSync(temp, fileOf(dir, lang));
  }
  return { written: written.length, rejected, missing: missing({ dir, lang }).length };
};

// The nested strings of one page in `lang`, English where the translation has nothing current.
export const stringsFor = ({ dir, lang = 'en', page }) => {
  const english = structuredClone(EN[page]);
  if (isEnglish(lang) || !dir) return { lang: isEnglish(lang) ? lang : 'en', strings: english, missing: 0 };
  const { strings, source } = readTranslation(dir, lang);
  let gaps = 0;
  const current = (key, sourceHash) => strings[key] !== undefined && source[key] === sourceHash;
  const walk = (node, prefix) => {
    for (const [key, value] of Object.entries(node)) {
      const path = `${prefix}.${key}`;
      if (typeof value === 'string') {
        const sourceHash = hash(value);
        if (current(path, sourceHash)) node[key] = strings[path];
        else gaps += 1;
      } else if (isPlural(value)) {
        const sourceHash = hash(JSON.stringify(value));
        const forms = {};
        for (const category of pluralCategories(lang)) {
          if (current(`${path}.${category}`, sourceHash)) forms[category] = strings[`${path}.${category}`];
          else gaps += 1;
        }
        // A plural with gaps stays English as a whole, so a number never meets a half-translated phrase.
        if (Object.keys(forms).length === pluralCategories(lang).length) node[key] = forms;
      } else if (value && typeof value === 'object') walk(value, path);
    }
  };
  walk(english, page);
  return { lang, strings: english, missing: gaps };
};

// The page's strings go in as their own inline script value; `</` would close the script early.
export const inject = (html, report, strings) =>
  html
    .replace('/*__REPORT__*/null', () => JSON.stringify(report).replace(/</g, '\\u003c'))
    .replace('/*__STRINGS__*/null', () => JSON.stringify(strings).replace(/</g, '\\u003c'))
    .replace('<html lang="en">', () => `<html lang="${strings.lang}">`);
