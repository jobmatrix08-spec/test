import i18n from 'i18next';

export type AppLanguage = 'fr' | 'ar';

export function getInitialLanguage(): AppLanguage {
  try {
    return localStorage.getItem('app-language') === 'ar' ? 'ar' : 'fr';
  } catch (error) {
    console.warn('Unable to read the saved language preference.', error);
    return 'fr';
  }
}

export async function setAppLanguage(language: AppLanguage): Promise<void> {
  await i18n.changeLanguage(language);
  try {
    localStorage.setItem('app-language', language);
  } catch (error) {
    console.warn('Unable to save the language preference locally.', error);
  }
}

export function applyDocumentLanguage(language: string): void {
  const isArabic = language.startsWith('ar');
  document.documentElement.lang = isArabic ? 'ar' : 'fr';
  document.documentElement.dir = isArabic ? 'rtl' : 'ltr';
}
