import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { EN, inject, merge, missing, needed, normLang, PAGES, stringsFor } from '../scripts/lib/i18n.mjs';
import { parseArgs, status } from '../scripts/i18n.mjs';
import { usage } from '../scripts/usage.mjs';
import { run } from '../scripts/context-tree.mjs';
import { FIXTURES, PLUGIN, scratch } from './helpers.mjs';

test('language codes', () => {
  assert.equal(normLang('pt-br'), 'pt-BR');
  assert.equal(normLang('RU'), 'ru');
  assert.throws(() => normLang('r u'), /language code/);
  assert.throws(() => parseArgs(['--lang', 'ru']), /--dir/);
  assert.throws(() => parseArgs(['--lang', 'ru', '--dir', 'x', '--pages', 'nope']), /unknown page/);
});

test('every string a page uses is in en.json', () => {
  const files = { preview: 'preview-page.html', usage: 'usage-page.html', context: 'context-tree-page.html' };
  for (const page of PAGES) {
    const html = readFileSync(join(PLUGIN, 'scripts', files[page]), 'utf8');
    assert.ok(html.includes('/*__STRINGS__*/null'), `${page} takes its strings from the script`);
    const used = [...new Set([...html.matchAll(/\bt\.(\w+)/g)].map((match) => match[1]))];
    assert.deepEqual(used.filter((key) => !(key in EN[page])), [], `${page} strings missing from en.json`);
  }
});

test('plurals ask for every form the language has', () => {
  const ru = needed('ru', ['usage']).filter((item) => item.key.startsWith('usage.days.')).map((item) => item.key);
  assert.deepEqual(ru.sort(), ['usage.days.few', 'usage.days.many', 'usage.days.one', 'usage.days.other']);
  const ja = needed('ja', ['usage']).filter((item) => item.key.startsWith('usage.days.')).map((item) => item.key);
  assert.deepEqual(ja, ['usage.days.other']);
  assert.deepEqual(missing({ dir: scratch(), lang: 'en-GB' }), [], 'English needs nothing');
});

test('translations are checked, stored, applied, and go stale when the English changes', () => {
  const dir = scratch();
  const before = status({ dir, lang: 'ru', pages: ['usage'] });
  assert.equal(before.count, Object.keys(before.missing).length);
  assert.ok(before.plurals.includes('usage.days'));
  const result = merge({
    dir,
    lang: 'ru',
    entries: {
      'usage.title': 'Расход Claude Code',
      'usage.days.one': '{n} день', 'usage.days.few': '{n} дня', 'usage.days.many': '{n} дней',
      'usage.activeOf.one': '{active} из {n}',
      'usage.cost': 'Стоимость {oops}',
      'usage.nothing': 'x',
    },
  });
  assert.equal(result.written, 5);
  assert.deepEqual(result.rejected.map((item) => item.key), ['usage.cost', 'usage.nothing']);
  const page = stringsFor({ dir, lang: 'ru', page: 'usage' });
  assert.equal(page.lang, 'ru');
  assert.equal(page.strings.title, 'Расход Claude Code');
  assert.equal(page.strings.cost, 'Cost', 'what is not translated stays English');
  assert.deepEqual(page.strings.days, EN.usage.days, 'a plural with a missing form stays English as a whole');
  merge({ dir, lang: 'ru', entries: { 'usage.days.other': '{n} дня' } });
  assert.deepEqual(stringsFor({ dir, lang: 'ru', page: 'usage' }).strings.days, { one: '{n} день', few: '{n} дня', many: '{n} дней', other: '{n} дня' });

  const file = join(dir, 'ru.json');
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  saved.source['usage.title'] = 'stale';
  writeFileSync(file, JSON.stringify(saved));
  assert.equal(stringsFor({ dir, lang: 'ru', page: 'usage' }).strings.title, 'Claude Code usage', 'a changed English string is shown in English again');
  assert.ok(missing({ dir, lang: 'ru', pages: ['usage'] }).some((item) => item.key === 'usage.title'));
  assert.throws(() => merge({ dir, lang: 'en', entries: {} }), /English/);
});

test('the page gets its language, and the usage store keeps it for the background hook', () => {
  const html = inject('<html lang="en"><script>const R = /*__REPORT__*/null; const L = /*__STRINGS__*/null;</script>', { a: '</script>' }, { lang: 'ru', strings: { x: 'y' } });
  assert.match(html, /<html lang="ru">/);
  assert.equal(html.split('</script>').length, 2, 'the inline report cannot close the script');

  const data = scratch();
  merge({ dir: join(data, 'i18n'), lang: 'ru', entries: { 'usage.title': 'Расход Claude Code', 'context.title': 'Дерево контекста' } });
  const home = join(FIXTURES, 'claude-home');
  const args = { project: '/tmp/demo-project', claudeHome: home, out: join(data, 'usage'), historyDays: 0, date: '2026-10-08T00:00:00Z' };
  const first = usage({ ...args, lang: 'ru' });
  assert.equal(first.lang, 'ru');
  assert.ok(first.untranslated > 0);
  const again = usage(args); // the hook passes no language
  const page = readFileSync(again.html, 'utf8');
  assert.match(page, /<html lang="ru">/);
  assert.ok(page.includes('Расход Claude Code'));

  const tree = run({ project: join(FIXTURES, 'ts-vite'), out: join(data, 'context'), claudeHome: scratch(), lang: 'ru' });
  assert.ok(readFileSync(tree.html, 'utf8').includes('Дерево контекста'));
  const english = run({ project: join(FIXTURES, 'ts-vite'), out: join(data, 'context'), claudeHome: scratch() });
  assert.match(readFileSync(english.html, 'utf8'), /<html lang="en">/);
});
