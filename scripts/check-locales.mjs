import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const locales = ['fr', 'ar'];
const localeFiles = Object.fromEntries(
  locales.map(locale => [locale, readdirSync(join('src', 'i18n', locale)).sort()]),
);

assert.deepEqual(localeFiles.ar, localeFiles.fr, 'French and Arabic must have the same namespaces.');

function getLeafKeys(value, prefix = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [prefix];
  return Object.entries(value)
    .flatMap(([key, child]) => getLeafKeys(child, prefix ? `${prefix}.${key}` : key))
    .sort();
}

for (const file of localeFiles.fr) {
  const french = JSON.parse(readFileSync(join('src', 'i18n', 'fr', file), 'utf8'));
  const arabic = JSON.parse(readFileSync(join('src', 'i18n', 'ar', file), 'utf8'));
  assert.deepEqual(getLeafKeys(arabic), getLeafKeys(french), `${file}: French and Arabic keys differ.`);
}

console.log('French and Arabic locale namespaces and keys match.');
