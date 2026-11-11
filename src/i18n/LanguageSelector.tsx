import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { setAppLanguage, type AppLanguage } from './language';

interface LanguageSelectorProps {
  onLanguageChange?: (language: AppLanguage) => void | Promise<void>;
  className?: string;
  compact?: boolean;
}

export default function LanguageSelector({ onLanguageChange, className = '', compact = false }: LanguageSelectorProps) {
  const { t, i18n } = useTranslation('common');
  const [saveError, setSaveError] = useState(false);
  const language = i18n.resolvedLanguage?.startsWith('ar') ? 'ar' : 'fr';

  const handleChange = async (nextLanguage: AppLanguage) => {
    setSaveError(false);
    try {
      await setAppLanguage(nextLanguage);
      await onLanguageChange?.(nextLanguage);
    } catch (error) {
      console.error('Unable to apply or save the selected language.', error);
      setSaveError(true);
    }
  };

  return (
    <div className={`inline-flex min-h-11 flex-col justify-center ${className}`}>
      <label className="inline-flex min-h-11 items-center gap-2 text-sm text-ds-text">
        <span className="sr-only">{t('language.label')}</span>
        <select
          aria-label={t('language.label')}
          value={language}
          onChange={event => void handleChange(event.target.value as AppLanguage)}
          className={`min-h-11 rounded-ds-md border border-ds-border bg-ds-surface text-base text-ds-text sm:text-sm ${compact ? 'min-w-[7rem] px-2' : 'px-3'}`}
        >
          <option value="fr">{t('language.french')}</option>
          <option value="ar">{t('language.arabic')}</option>
        </select>
      </label>
      {saveError && <span role="alert" className="max-w-40 text-[10px] text-ds-danger">{t('language.saveError')}</span>}
    </div>
  );
}
