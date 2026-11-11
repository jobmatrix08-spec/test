import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { DARK_THEME_COLOR, ThemeProvider } from './components/ThemeProvider';
import { BrandProvider } from './components/BrandProvider';
import './i18n';
import './index.css';
import '@fontsource-variable/inter';
import '@fontsource/noto-sans-arabic/400.css';
import '@fontsource/noto-sans-arabic/700.css';
import { APP_BRAND_COLORS } from './config/brand';

// Purge any stale custom_session from obsolete runs
try {
  const session = localStorage.getItem('custom_session');
  if (session) {
    const parsed = JSON.parse(session);
    if (parsed?.uid === 'phoneclinic_admin' || !parsed?.uid) {
      localStorage.removeItem('custom_session');
    }
  }
} catch {
  try {
    localStorage.removeItem('custom_session');
  } catch (error) {
    console.warn('Unable to remove the obsolete session from local storage.', error);
  }
}

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <ThemeProvider>
        <BrandProvider>
          <App />
        </BrandProvider>
      </ThemeProvider>
    </StrictMode>,
  );
}

document.documentElement.style.setProperty('--brand-primary', APP_BRAND_COLORS.primary);
const initialThemeColor = document.documentElement.dataset.theme === 'dark'
  ? DARK_THEME_COLOR
  : APP_BRAND_COLORS.primary;
document.querySelector('meta[name="theme-color"]')?.setAttribute('content', initialThemeColor);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const buildId = document.querySelector<HTMLMetaElement>('meta[name="app-build-id"]')?.content;
    const workerUrl = new URL('/sw.js', window.location.origin);
    if (buildId) workerUrl.searchParams.set('v', buildId);
    void navigator.serviceWorker.register(workerUrl.toString(), { updateViaCache: 'none' }).catch(() => {
      console.error('Unable to register the application service worker.');
    });
  });
}
