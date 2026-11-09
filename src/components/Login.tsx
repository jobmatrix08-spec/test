import React, { useEffect, useState } from 'react';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithRedirect, GoogleAuthProvider, signOut, sendPasswordResetEmail } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { AlertCircle, Chrome } from 'lucide-react';
import { ALLOW_SELF_SIGNUP } from '../config/firebase';
import BrandLogo from './BrandLogo';
import { useBrand } from './BrandProvider';
import { Button, Card, Input } from './ui';
import { useTranslation } from 'react-i18next';
import LanguageSelector from '../i18n/LanguageSelector';

export default function Login({ initialMessage = '' }: { initialMessage?: string }) {
  const { t } = useTranslation('auth');
  const { storeName } = useBrand();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState('');
  const [resetMessage, setResetMessage] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (initialMessage) setError(initialMessage);
  }, [initialMessage]);

  const handleGoogleLogin = async () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });

    setError('');
    setLoading(true);

    try {
      await signInWithRedirect(auth, provider);
    } catch (err: any) {
      console.error('Google sign-in failed.');

      if (err?.code === 'auth/unauthorized-domain') {
        setError(t('errors.unauthorizedDomain', { hostname: window.location.hostname }));
      } else if (err?.code === 'auth/operation-not-allowed') {
        setError(t('errors.googleDisabled'));
      } else if (err?.code === 'auth/network-request-failed') {
        setError(t('errors.network'));
      } else {
        console.error('Google sign-in redirect failed.');
        setError(t('errors.googleFailed'));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isRegistering) {
        if (!ALLOW_SELF_SIGNUP) {
          throw new Error(t('errors.signupDisabled'));
        }
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        // Connexion Firebase Auth d'abord (les règles Firestore exigent un utilisateur authentifié pour lire)
        const userCred = await signInWithEmailAndPassword(auth, email, password);

        // Ensuite, vérifier dans Firestore si le compte est banni.
        // Lecture directe par UID (plus fiable qu'une requête "list" par email),
        // avec quelques tentatives en cas de léger retard de propagation du jeton d'authentification.
        let profileData: any = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const userSnap = await getDoc(doc(db, 'users', userCred.user.uid));
            if (userSnap.exists()) {
              profileData = userSnap.data();
            }
            break;
          } catch (checkErr: any) {
            const isPermissionIssue = checkErr.code === 'permission-denied';
            if (isPermissionIssue && attempt < 2) {
              await new Promise((resolve) => setTimeout(resolve, 400));
              continue;
            }
            // Après plusieurs tentatives, on ne bloque pas la connexion pour ça :
            // le contrôle du statut banni sera de toute façon réappliqué en temps réel
            // par l'écoute du profil dans App.tsx.
            console.warn('Account status check is temporarily unavailable.');
            break;
          }
        }

        if (profileData) {
          if (profileData.status === 'banned') {
            await signOut(auth);
            throw new Error(t('errors.banned'));
          }
        }
      }
    } catch (err: any) {
      if (err.code === 'auth/operation-not-allowed') {
        setError(t('errors.emailDisabled'));
      } else {
        setError(err.message || t('errors.generic'));
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordReset = async () => {
    setError('');
    setResetMessage('');
    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setError(t('errors.emailRequired'));
      return;
    }
    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, cleanEmail);
      setResetMessage(t('errors.resetSent'));
    } catch (resetError) {
      const code = typeof resetError === 'object' && resetError !== null && 'code' in resetError ? resetError.code : '';
      setError(code === 'auth/invalid-email'
        ? t('errors.emailInvalid')
        : t('errors.resetFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-ds-bg p-4">
      <div className="flex w-full max-w-md justify-end">
        <LanguageSelector />
      </div>
      <Card className="w-full max-w-md p-6 sm:p-8">
        <div className="text-center mb-8">
          <BrandLogo variant="full" className="mb-5 justify-center" />
          <h1 className="sr-only">{storeName}</h1>
          <p className="mt-2 text-xs font-medium text-ds-muted sm:text-sm">
            {t('subtitle')}
          </p>
        </div>

        {error && (
          <div role="alert" className="mb-6 flex items-center gap-3 rounded-ds-lg border border-ds-danger/20 bg-ds-danger-soft p-4 text-xs text-ds-danger sm:text-sm">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <p className="min-w-0">{error}</p>
          </div>
        )}

        {/* Primary Google Login Button */}
        <div className="space-y-3">
          <Button
            onClick={handleGoogleLogin}
            loading={loading}
            className="w-full rounded-ds-lg py-3.5 text-sm font-extrabold shadow-ds-sm sm:py-4 sm:text-base"
          >
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-ds-surface">
              <Chrome className="h-4 w-4 text-ds-brand" />
            </div>
            <span>{t('google')}</span>
          </Button>
          <p className="text-center text-[11px] font-medium text-ds-muted">
            {t('secureGoogle')}
          </p>
        </div>

        <div className="my-6 flex items-center gap-4">
          <div className="h-px flex-1 bg-ds-border"></div>
          <span className="text-[10px] font-black uppercase tracking-wider text-ds-muted">{t('orCredentials')}</span>
          <div className="h-px flex-1 bg-ds-border"></div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label={t('email')}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="contact@example.com"
          />

          <Input
            label={t('password')}
            type="password"
            autoComplete={isRegistering ? 'new-password' : 'current-password'}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />

          <Button
            type="submit"
            loading={loading}
            className="w-full text-xs font-bold shadow-ds-sm sm:text-sm"
          >
            {loading ? t('loading') : isRegistering ? t('createAccount') : t('signInEmail')}
          </Button>
        </form>

        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={() => void handlePasswordReset()}
            disabled={loading}
            className="min-h-11 rounded-ds-sm px-3 text-xs font-semibold text-ds-brand underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ds-brand disabled:opacity-50"
          >
            {t('forgotPassword')}
          </button>
          {resetMessage && <p role="status" className="mt-2 text-xs font-semibold text-ds-success">{resetMessage}</p>}
        </div>

        {ALLOW_SELF_SIGNUP && <div className="mt-6 text-center">
          <button
            onClick={() => setIsRegistering(!isRegistering)}
            className="min-h-11 px-2 text-xs font-semibold text-ds-brand transition-colors hover:text-ds-brand-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ds-brand"
          >
            {isRegistering ? t('alreadyAccount') : t('needAccount')}
          </button>
        </div>}
      </Card>
    </div>
  );
}
