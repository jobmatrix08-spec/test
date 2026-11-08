export type ProductAttributeFieldType = 'text' | 'choice' | 'boolean' | 'number';

export interface ProductAttributeField {
  key: string;
  label: string;
  type: ProductAttributeFieldType;
  options?: string[];
}

export interface ProductAttributeType {
  id: string;
  name: string;
  fields: ProductAttributeField[];
}

export const DEFAULT_PRODUCT_ATTRIBUTE_TYPES: ProductAttributeType[] = [
  {
    id: 'phone',
    name: 'Téléphone',
    fields: [
      { key: 'system', label: 'Système', type: 'choice', options: ['Android', 'iPhone'] },
      { key: 'ram', label: 'RAM', type: 'text' },
      { key: 'storage', label: 'Stockage', type: 'text' },
      { key: 'color', label: 'Couleur', type: 'text' },
      { key: 'condition', label: 'État', type: 'text' },
    ],
  },
  {
    id: 'computer',
    name: 'Ordinateur',
    fields: [
      { key: 'processor', label: 'Processeur', type: 'text' },
      { key: 'ram', label: 'RAM', type: 'text' },
      { key: 'storage', label: 'Stockage', type: 'text' },
      { key: 'condition', label: 'État', type: 'text' },
    ],
  },
  {
    id: 'screen-protection',
    name: "Protection d'écran",
    fields: [
      { key: 'anti-break', label: 'Anti-casse', type: 'choice', options: ['Fumé', 'Miroir', 'Normal'] },
    ],
  },
  {
    id: 'charger-cable',
    name: 'Chargeur/câble',
    fields: [
      { key: 'connector', label: 'Connecteur', type: 'text' },
      { key: 'fast-charge', label: 'Charge rapide', type: 'boolean' },
      { key: 'power', label: 'Puissance', type: 'number' },
    ],
  },
  {
    id: 'accessory',
    name: 'Accessoire générique',
    fields: [],
  },
];

export function normalizeAttributeValue(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase();
}

export function formatProductDetails(
  attributes?: Record<string, string>,
  serialNumber?: string,
): string {
  const values = Object.entries(attributes || {})
    .filter(([, value]) => value.trim())
    .map(([label, value]) => `${label}: ${value.trim()}`);
  if (serialNumber?.trim()) values.push(`IMEI / n° de série: ${serialNumber.trim()}`);
  return values.join(' · ');
}
