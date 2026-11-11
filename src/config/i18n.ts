export const ARABIC_GLOSSARY = [
  { french: 'Caisse', aliases: ['الصندوق', 'صندوق', 'الكاسة', 'كاسة'] },
  { french: 'Stock', aliases: ['المخزون', 'مخزون', 'الستوك', 'ستوك'] },
  { french: 'Facture', aliases: ['الفوترة', 'الفواتير', 'الفاتورة', 'فواتير', 'فاتورة'] },
  { french: 'Accueil', aliases: ['لوحة القيادة', 'لوحة التحكم'] },
  { french: 'IMEI', aliases: [] },
  { french: 'POS', aliases: ['نقطة البيع'] },
] as const;

export function applyArabicGlossary<T>(resource: T): T {
  const aliases = ARABIC_GLOSSARY.flatMap(({ french, aliases: terms }) =>
    terms.map(alias => [alias, french] as const),
  ).sort(([left], [right]) => right.length - left.length);

  const translate = (value: unknown): unknown => {
    if (typeof value === 'string') {
      return aliases.reduce((text, [alias, french]) => text.replaceAll(alias, french), value);
    }
    if (Array.isArray(value)) return value.map(translate);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, translate(item)]));
    }
    return value;
  };

  return translate(resource) as T;
}
