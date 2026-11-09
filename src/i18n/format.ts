import i18n from 'i18next';

export function getDateLocale(): 'fr-TN' | 'ar-TN' {
  return i18n.resolvedLanguage?.startsWith('ar') ? 'ar-TN' : 'fr-TN';
}

export function formatDateTime(date: Date, options: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat(getDateLocale(), {
    numberingSystem: 'latn',
    ...options,
  }).format(date);
}
