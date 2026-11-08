import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_PRODUCT_ATTRIBUTE_TYPES,
  formatProductDetails,
  normalizeAttributeValue,
} from './productAttributes';

test('default product attribute templates cover the requested product types', () => {
  assert.deepEqual(DEFAULT_PRODUCT_ATTRIBUTE_TYPES.map(type => type.id), [
    'phone',
    'computer',
    'screen-protection',
    'charger-cable',
    'accessory',
  ]);
  assert.equal(DEFAULT_PRODUCT_ATTRIBUTE_TYPES[0].fields.length, 5);
  assert.equal(DEFAULT_PRODUCT_ATTRIBUTE_TYPES[3].fields.find(field => field.key === 'fast-charge')?.type, 'boolean');
});

test('attribute normalization ignores case and diacritics', () => {
  assert.equal(normalizeAttributeValue('  FUMÉ  '), 'fume');
  assert.equal(normalizeAttributeValue('iPhone'), normalizeAttributeValue('IPHÔNE'));
});

test('product details include optional attributes and serial number', () => {
  assert.equal(
    formatProductDetails({ RAM: '8 Go', Couleur: 'Noir' }, 'IMEI-123'),
    'RAM: 8 Go · Couleur: Noir · IMEI / n° de série: IMEI-123',
  );
  assert.equal(formatProductDetails(), '');
});
