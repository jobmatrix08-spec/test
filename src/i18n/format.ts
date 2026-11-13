import i18n from 'i18next';

export type DocumentLanguage = 'fr' | 'ar' | 'both';

export function getDateLocale(): 'fr-TN-u-nu-latn' | 'ar-TN-u-nu-latn' {
  return i18n.resolvedLanguage?.startsWith('ar') ? 'ar-TN-u-nu-latn' : 'fr-TN-u-nu-latn';
}

export function formatDateTime(date: Date, options: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat(getDateLocale(), {
    numberingSystem: 'latn',
    ...options,
  }).format(date);
}

export function formatDocumentDate(date: Date, language: DocumentLanguage = 'fr'): string {
  const formatForLocale = (locale: 'fr-TN' | 'ar-TN') => new Intl.DateTimeFormat(locale, {
    numberingSystem: 'latn',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);

  if (language === 'both') return `${formatForLocale('fr-TN')} / ${formatForLocale('ar-TN')}`;
  return formatForLocale(language === 'ar' ? 'ar-TN' : 'fr-TN');
}

export function formatNumber(value: number, options: Intl.NumberFormatOptions = {}): string {
  const maximumFractionDigits = options.maximumFractionDigits ?? 3;
  const normalizedValue = Number.isFinite(value) &&
    (Object.is(value, -0) || Math.abs(value) < 0.5 * (10 ** -maximumFractionDigits))
    ? 0
    : value;

  return new Intl.NumberFormat(getDateLocale(), {
    numberingSystem: 'latn',
    ...options,
  }).format(normalizedValue);
}

export function formatMoney(value: number): string {
  return formatNumber(value, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}
