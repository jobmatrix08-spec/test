import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { cn } from '../lib/utils';
import { useTranslation } from 'react-i18next';

export type ThemePreference = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const THEME_STORAGE_KEY = 'phone-clinic-theme';
export const DARK_THEME_COLOR = '#0B1220';

function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

function readThemePreference(): ThemePreference {
  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(storedTheme) ? storedTheme : 'system';
  } catch (error) {
    console.warn('Unable to read the saved theme preference.', error);
    return 'system';
  }
}

function applyTheme(theme: ThemePreference, systemPrefersDark: boolean) {
  const resolvedTheme = theme === 'system' ? (systemPrefersDark ? 'dark' : 'light') : theme;
  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.style.colorScheme = resolvedTheme;

  const styles = getComputedStyle(document.documentElement);
  const themeColor = resolvedTheme === 'dark'
    ? DARK_THEME_COLOR
    : styles.getPropertyValue('--brand-primary').trim() || styles.getPropertyValue('--ds-brand').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemePreference>(readThemePreference);

  useEffect(() => {
    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
    const updateTheme = () => applyTheme(theme, systemTheme.matches);
    updateTheme();

    if (theme === 'system') systemTheme.addEventListener('change', updateTheme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch (error) {
      console.warn('Unable to save the theme preference.', error);
    }

    return () => {
      if (theme === 'system') systemTheme.removeEventListener('change', updateTheme);
    };
  }, [theme]);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider.');
  return context;
}

export function ThemeSelector({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const { t } = useTranslation('settings');
  const Icon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;

  return (
    <label className={cn('flex min-h-11 items-center gap-2 rounded-ds-md border border-ds-border bg-ds-surface px-3 text-ds-text', className)}>
      <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-ds-brand" />
      <span className="sr-only">{t('appearance.theme')}</span>
      <select
        aria-label={t('appearance.theme')}
        value={theme}
        onChange={(event) => setTheme(event.target.value as ThemePreference)}
        className="min-w-0 cursor-pointer bg-transparent text-sm font-semibold text-ds-text outline-none"
      >
        <option value="light">{t('appearance.light')}</option>
        <option value="dark">{t('appearance.dark')}</option>
        <option value="system">{t('appearance.system')}</option>
      </select>
    </label>
  );
}
