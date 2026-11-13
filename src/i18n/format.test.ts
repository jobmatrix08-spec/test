import assert from 'node:assert/strict';
import test from 'node:test';
import { formatMoney, formatNumber, getDateLocale } from './format.ts';

test('money formatting uses three decimals and never renders negative zero', () => {
  const options = { minimumFractionDigits: 3, maximumFractionDigits: 3 };
  assert.equal(formatMoney(12.5), new Intl.NumberFormat(getDateLocale(), {
    numberingSystem: 'latn',
    ...options,
  }).format(12.5));
  assert.equal(formatNumber(-0.0001, options), formatNumber(0, options));
});
