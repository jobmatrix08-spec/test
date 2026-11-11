import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { APP_BRAND_COLORS, APP_LOGO_URL, APP_TAGLINE } from '../config/brand';
import { DEFAULT_STORE_NAME } from '../config/brand-defaults';

const BRAND_CACHE_KEY = 'phone-clinic-brand';

export interface Brand {
  storeName: string;
  storeTagline: string;
  logo: string;
}

interface BrandContextValue extends Brand {
  error: string | null;
}

const defaultBrand: Brand = {
  storeName: DEFAULT_STORE_NAME,
  storeTagline: APP_TAGLINE,
  logo: APP_LOGO_URL,
};

const BrandContext = createContext<BrandContextValue>({
  ...defaultBrand,
  error: null,
});

function normalizeBrand(value: Partial<Brand> | null | undefined): Brand {
  return {
    storeName: typeof value?.storeName === 'string' && value.storeName.trim()
      ? value.storeName.trim()
      : defaultBrand.storeName,
    storeTagline: typeof value?.storeTagline === 'string' ? value.storeTagline.trim() : defaultBrand.storeTagline,
    logo: typeof value?.logo === 'string' ? value.logo.trim() : defaultBrand.logo,
  };
}

function readCachedBrand(): Brand {
  try {
    const cachedValue = localStorage.getItem(BRAND_CACHE_KEY);
    if (cachedValue) return normalizeBrand(JSON.parse(cachedValue) as Partial<Brand>);
  } catch (error) {
    console.warn('Unable to read the cached brand settings:', error);
  }
  return defaultBrand;
}

function writeCachedBrand(brand: Brand) {
  try {
    localStorage.setItem(BRAND_CACHE_KEY, JSON.stringify(brand));
  } catch (error) {
    console.warn('Unable to cache the brand settings:', error);
  }
}

export function BrandProvider({ children }: { children: ReactNode }) {
  const [brand, setBrand] = useState<Brand>(readCachedBrand);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let authRequest = 0;
    let unsubscribeSettings: (() => void) | undefined;

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      const currentRequest = ++authRequest;
      unsubscribeSettings?.();
      unsubscribeSettings = undefined;
      setError(null);
      if (!user) return;

      void (async () => {
        let ownerId = user.uid;
        try {
          const userSnapshot = await getDoc(doc(db, 'users', user.uid));
          const profile = userSnapshot.data();
          const profileOwnerId = profile?.role === 'admin' ? user.uid : profile?.ownerId;
          if (typeof profileOwnerId === 'string' && profileOwnerId) ownerId = profileOwnerId;
        } catch (profileError) {
          console.error('Unable to load the account profile for brand settings:', profileError);
          if (active && currentRequest === authRequest) {
            setError('Impossible de charger le profil associé à la marque. Les dernières informations enregistrées sont affichées.');
          }
        }

        if (!active || currentRequest !== authRequest) return;
        unsubscribeSettings = onSnapshot(
          doc(db, 'settings', ownerId),
          (snapshot) => {
            const nextBrand = snapshot.exists()
              ? normalizeBrand(snapshot.data() as Partial<Brand>)
              : defaultBrand;
            setBrand(nextBrand);
            writeCachedBrand(nextBrand);
            setError(null);
          },
          (settingsError) => {
            console.error('Unable to load live brand settings:', settingsError);
            setError('Impossible de synchroniser la marque depuis Firestore. Les dernières informations enregistrées sont affichées.');
          },
        );
      })();
    }, (authError) => {
      console.error('Unable to observe the authentication state for brand settings:', authError);
      setError('Impossible de vérifier la session pour synchroniser la marque.');
    });

    return () => {
      active = false;
      unsubscribeSettings?.();
      unsubscribeAuth();
    };
  }, []);

  useEffect(() => {
    document.title = brand.storeName;
    document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', brand.storeName);
    document.querySelector('meta[name="description"]')?.setAttribute(
      'content',
      brand.storeTagline ? `${brand.storeName} — ${brand.storeTagline}` : brand.storeName,
    );
    document.querySelector('meta[property="og:title"]')?.setAttribute('content', brand.storeName);
    document.querySelector('meta[property="og:description"]')?.setAttribute(
      'content',
      brand.storeTagline ? `${brand.storeName} — ${brand.storeTagline}` : brand.storeName,
    );
    document.querySelector('meta[property="og:image"]')?.setAttribute('content', brand.logo);
    document.querySelector('meta[property="twitter:title"]')?.setAttribute('content', brand.storeName);
    document.querySelector('meta[property="twitter:description"]')?.setAttribute(
      'content',
      brand.storeTagline ? `${brand.storeName} — ${brand.storeTagline}` : brand.storeName,
    );
    document.querySelector('meta[property="twitter:image"]')?.setAttribute('content', brand.logo);
    if (brand.logo) {
      document.querySelector('link[rel="icon"]')?.setAttribute('href', brand.logo);
      document.querySelector('link[rel="apple-touch-icon"]')?.setAttribute('href', brand.logo);
    }

    const manifestLink = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (!manifestLink) return;
    const manifestUrl = URL.createObjectURL(new Blob([JSON.stringify({
      name: brand.storeName,
      short_name: brand.storeName,
      description: brand.storeTagline ? `${brand.storeName} — ${brand.storeTagline}` : brand.storeName,
      start_url: '/',
      scope: '/',
      display: 'standalone',
      orientation: 'any',
      lang: 'fr',
      theme_color: APP_BRAND_COLORS.primary,
      background_color: '#0B1220',
      categories: ['business', 'productivity'],
      icons: brand.logo
        ? [{ src: brand.logo, sizes: '192x192', purpose: 'any' }]
        : [
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
    })], { type: 'application/manifest+json' }));
    manifestLink.href = manifestUrl;
    return () => URL.revokeObjectURL(manifestUrl);
  }, [brand]);

  return (
    <BrandContext.Provider value={{ ...brand, error }}>
      {children}
    </BrandContext.Provider>
  );
}

export function useBrand(): BrandContextValue {
  return useContext(BrandContext);
}
