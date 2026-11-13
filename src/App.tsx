import React, { useEffect, useState, Component } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { auth, db } from './firebase';
import { doc, getDoc, setDoc, updateDoc, onSnapshot, collection, query, orderBy, where } from 'firebase/firestore';
import { 
  LayoutDashboard, 
  Package, 
  Users, 
  ShoppingCart, 
  History, 
  LogOut, 
  Menu, 
  X,
  AlertTriangle,
  FileText,
  RefreshCcw,
  Settings as SettingsIcon,
  UserCheck,
  StickyNote,
  Bell,
  Calendar,
  CheckCircle,
  Wifi,
  WifiOff,
  Wrench,
  BookOpen,
  CircleDollarSign,
  BarChart3,
} from 'lucide-react';
import { cn } from './lib/utils';
import type { UserProfile, Note, CashSession as CashSessionRecord } from './types';
import { Badge } from './components/ui';
import { getPendingOperations, syncPendingOperations } from './lib/offlineManager';
import { hasMenuAccess } from './lib/permissions';
import BrandLogo from './components/BrandLogo';
import { useBrand } from './components/BrandProvider';
import { ThemeSelector } from './components/ThemeProvider';
import { ALLOW_SELF_SIGNUP } from './config/firebase';
import { useCashSession } from './lib/cashSessions';
import { useTranslation } from 'react-i18next';
import LanguageSelector from './i18n/LanguageSelector';
import { setAppLanguage, type AppLanguage } from './i18n/language';
import { formatDateTime, getDateLocale } from './i18n/format';
import i18n from './i18n';
export { hasMenuAccess } from './lib/permissions';

const NAV_SECTIONS = [
  {
    title: 'sections.sales',
    items: [
      { id: 'dashboard', name: 'dashboard', path: '/', icon: LayoutDashboard },
      { id: 'pos', name: 'pos', path: '/pos', icon: ShoppingCart },
      { id: 'sales', name: 'salesHistory', path: '/sales', icon: History },
      { id: 'invoices', name: 'invoices', path: '/invoices', icon: FileText },
      { id: 'invoices', name: 'cashSession', path: '/cash-session', icon: CircleDollarSign },
    ],
  },
  {
    title: 'sections.workshop',
    items: [
      { id: 'reparation', name: 'repairs', path: '/repairs', icon: Wrench },
      { id: 'pieces', name: 'parts', path: '/parts', icon: Package },
    ],
  },
  {
    title: 'sections.catalog',
    items: [
      { id: 'products', name: 'products', path: '/products', icon: Package },
      { id: 'clients', name: 'clients', path: '/clients', icon: Users },
    ],
  },
  {
    title: 'sections.tools',
    items: [
      { id: 'notes', name: 'notes', path: '/notes', icon: StickyNote },
      { id: 'startup', name: 'startup', path: '/settings#startup-settings', icon: BookOpen, adminOnly: true },
    ],
  },
  {
    title: 'sections.administration',
    items: [
      { id: 'users', name: 'users', path: '/users', icon: UserCheck, adminOnly: true },
      { id: 'reports', name: 'reports', path: '/reports', icon: BarChart3, adminOnly: true },
      { id: 'expenses', name: 'expenses', path: '/expenses', icon: CircleDollarSign, adminOnly: true },
      { id: 'settings', name: 'settings', path: '/settings', icon: SettingsIcon },
    ],
  },
];

function isAdminOwner(userProfile: UserProfile | null): boolean {
  return userProfile?.role === 'admin' &&
    (userProfile.ownerId || userProfile.uid) === userProfile.uid;
}

function getAccessibleNavigation(userProfile: UserProfile | null) {
  return NAV_SECTIONS.map(section => ({
    ...section,
    items: section.items.filter(item => {
      if (item.adminOnly && !isAdminOwner(userProfile)) return false;
      if (item.id === 'settings') return true;
      if (item.id === 'startup') return isAdminOwner(userProfile);
      return hasMenuAccess(userProfile, item.id);
    }),
  })).filter(section => section.items.length > 0);
}

function getFirstAccessiblePath(userProfile: UserProfile | null): string {
  return getAccessibleNavigation(userProfile).flatMap(section => section.items)[0]?.path || '/settings';
}

function CurrentPageTitle({ userProfile }: { userProfile: UserProfile | null }) {
  const { t } = useTranslation('nav');
  const location = useLocation();
  const currentItem = getAccessibleNavigation(userProfile)
    .flatMap(section => section.items)
    .find(item => item.path === `${location.pathname}${location.hash}` || item.path === location.pathname);

  return <h1 className="truncate text-base font-bold text-ds-text sm:text-lg">{currentItem ? t(currentItem.name) : t('settings')}</h1>;
}

// Components
import Dashboard from './components/Dashboard';
import Products from './components/Products';
import Clients from './components/Clients';
import POS from './components/POS';
import Sales from './components/Sales';
import Invoices from './components/Invoices';
import Settings from './components/Settings';
import Login from './components/Login';
import UsersManager from './components/Users';
import Notes from './components/Notes';
import Repairs from './components/Repairs';
import Parts from './components/Parts';
import Expenses from './components/Expenses';
import Reports from './components/Reports';
import CashSession from './components/CashSession';
import { StartupProvider } from './components/StartupProvider';

// Error Handling
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export function handleFirestoreError(error: unknown, operationType: OperationType, _path: string | null) {
  console.error('Firestore operation failed:', operationType);
  throw error instanceof Error ? error : new Error('Firestore operation failed.');
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: any;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(_error: any, _errorInfo: any) {
    console.error('An unexpected application error occurred.');
  }

  render() {
    if (this.state.hasError) {
      const errorT = i18n.getFixedT(i18n.resolvedLanguage || 'fr', 'common');
      let displayError = errorT('error');
      try {
        const parsed = JSON.parse(this.state.error.message);
        if (parsed.error) displayError = parsed.error;
      } catch {
        displayError = this.state.error?.message || displayError;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
          <div className="bg-white p-8 rounded-3xl shadow-xl border border-red-100 max-w-md w-full text-center">
            <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-6">
              <AlertTriangle className="w-8 h-8" />
            </div>
            <h1 className="text-2xl font-black text-gray-900 mb-2">{errorT('unexpectedTitle')}</h1>
            <p className="text-gray-600 mb-8">{displayError}</p>
            <button
              onClick={() => window.location.reload()}
              className="w-full flex items-center justify-center gap-2 bg-indigo-600 text-white py-3 rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-600/10"
            >
              <RefreshCcw className="w-5 h-5" />
              {errorT('refreshPage')}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// Livraison / encaissement / remise des réparations : admin ou profil de vente
// (menu 'pos'). Jamais le Technicien (qui n'a que le menu 'reparation').
// Doit rester aligné avec canCash() dans firestore.rules.
export function canCashRepairs(userProfile: UserProfile | null): boolean {
  return !!userProfile && (userProfile.role === 'admin' || hasMenuAccess(userProfile, 'pos'));
}

function Sidebar({ 
  isOpen, 
  setIsOpen, 
  userProfile, 
  todayNotesCount,
  deferredPrompt,
  handleInstallApp,
  isOnline,
  pendingCount,
  syncing,
  handleTriggerSync,
  cashSession,
  cashSessionLoading,
}: { 
  isOpen: boolean; 
  setIsOpen: (v: boolean) => void; 
  userProfile: UserProfile | null; 
  todayNotesCount: number;
  deferredPrompt: any;
  handleInstallApp: () => void;
  isOnline: boolean;
  pendingCount: number;
  syncing: boolean;
  handleTriggerSync: () => void;
  cashSession: CashSessionRecord | null;
  cashSessionLoading: boolean;
}) {
  const { t: navT, i18n } = useTranslation('nav');
  const { t } = useTranslation('common');
  const { storeName } = useBrand();
  const location = useLocation();
  const isRtl = i18n.dir() === 'rtl';
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone;
  const navSections = getAccessibleNavigation(userProfile);
  const canAccessCashSession = hasMenuAccess(userProfile, 'pos') || hasMenuAccess(userProfile, 'invoices');

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpen && (
        <div 
          className="fixed inset-0 z-40 bg-ds-text/25 backdrop-blur-sm transition-opacity duration-300 lg:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}
      
      <aside className={cn(
        "fixed inset-y-0 start-0 z-50 w-[min(18rem,calc(100vw-1rem))] border-e border-ds-border bg-ds-surface text-ds-text shadow-xl shadow-ds-text/10 transition-transform duration-300 lg:translate-x-0 lg:w-72 lg:shadow-none",
        isOpen ? "translate-x-0" : isRtl ? "translate-x-full" : "-translate-x-full"
      )}>
        <div className="h-full flex flex-col">
          <div className="flex items-center justify-between border-b border-ds-border px-5 py-5">
            <div className="min-w-0">
              <BrandLogo variant="full" />
            </div>
            <button onClick={() => setIsOpen(false)} aria-label={navT('closeMenu')} className="ms-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-ds-muted transition-colors hover:bg-ds-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ds-brand lg:hidden">
              <X className="h-5 w-5" />
            </button>
          </div>

          <nav aria-label={navT('mainNavigation')} className="flex-1 space-y-3 overflow-y-auto px-4 py-5">
            {navSections.map(section => (
              <section key={section.title} aria-label={navT(section.title)}>
                <h2 className="px-3 pb-2 pt-3 text-[10px] font-bold uppercase tracking-[0.15em] text-ds-muted">{navT(section.title)}</h2>
                <div className="space-y-1">
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    const isActive = item.path === '/settings#startup-settings'
                      ? location.pathname === '/settings' && location.hash === '#startup-settings'
                      : location.pathname === item.path;
                    return (
                      <Link
                        key={item.path}
                        to={item.path}
                        onClick={() => setIsOpen(false)}
                        className={cn(
                          "group relative flex min-h-11 items-center gap-3 rounded-ds-md px-3 text-[13px] font-semibold transition-colors duration-160 before:absolute before:inset-y-2 before:start-0 before:w-1 before:rounded-e-full before:bg-ds-brand before:content-[''] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ds-brand",
                          isActive
                            ? "bg-ds-brand-soft font-bold text-ds-brand before:opacity-100"
                            : "text-ds-muted before:opacity-0 hover:bg-ds-surface-2 hover:text-ds-text"
                        )}
                        aria-current={isActive ? 'page' : undefined}
                      >
                        <Icon className={cn("h-[18px] w-[18px] shrink-0", isActive ? "text-ds-brand" : "text-ds-muted")} />
                        <span className="flex-1">{navT(item.name)}</span>
                        {item.id === 'notes' && todayNotesCount > 0 && (
                          <span className={cn("min-w-[18px] rounded-full px-2 py-0.5 text-center text-[10px] font-black", isActive ? "bg-ds-brand text-ds-brand-contrast" : "bg-ds-danger-soft text-ds-danger")}>
                            {todayNotesCount}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </section>
            ))}
          </nav>

          <div className="border-t border-ds-border px-4 py-3">
            <ThemeSelector className="w-full justify-center lg:hidden" />
          </div>

          {/* PWA / Offline Status Cards in Sidebar */}
          {canAccessCashSession && <div className="space-y-3 px-4 py-3">
            <div className="flex flex-col gap-3 rounded-ds-lg border border-ds-border bg-ds-surface-2 p-4">
              <div className="flex items-center gap-2.5">
                <Badge variant={cashSession ? 'success' : 'neutral'} className="min-h-7 px-2 text-[10px] uppercase tracking-wide">
                  {cashSession ? t('cashOpen') : cashSessionLoading ? t('loadingCash') : t('noCash')}
                </Badge>
              </div>
              {cashSession && <p className="text-[12px] font-medium text-ds-muted">{t('sessionSince', { time: cashSession.openedAt?.toDate?.() ? formatDateTime(cashSession.openedAt.toDate(), { hour: '2-digit', minute: '2-digit' }) : '—', name: userProfile?.name || userProfile?.email || t('unknownUser') })}</p>}
              {location.pathname !== '/cash-session' && <Link to="/cash-session" onClick={() => setIsOpen(false)} className="flex min-h-11 items-center justify-center rounded-ds-md border border-ds-border bg-ds-surface px-3 text-sm font-bold text-ds-text transition-colors hover:bg-ds-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ds-brand">
                {cashSession ? t('closeCash') : t('openCash')}
              </Link>}
            </div>
          </div>}

          <div className="border-t border-ds-border px-4 py-3">
            {/* Connection and Sync Status */}
            {!isOnline ? (
              <div className="rounded-ds-md border border-ds-warning/20 bg-ds-warning-soft p-3 text-xs text-ds-warning">
                <div className="mb-1 flex items-center gap-2 text-[10px] font-black uppercase tracking-wider">
                  <WifiOff className="h-3.5 w-3.5 animate-pulse" />
                  <Badge variant="warning" className="min-h-7 px-2">{t('offlineMode')}</Badge>
                </div>
                <p className="text-[11px] font-medium leading-relaxed">
                  {t('localSaved')} {pendingCount > 0 ? t('operationsWaiting', { count: pendingCount }) : t('reconnectReady')}
                </p>
              </div>
            ) : pendingCount > 0 ? (
              <div className="rounded-ds-md border border-ds-brand/20 bg-ds-brand-soft p-3 text-xs text-ds-brand">
                <div className="mb-1 flex items-center justify-between gap-2 text-[10px] font-black uppercase tracking-wider">
                  <span className="flex items-center gap-1.5">
                    <RefreshCcw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
                    <Badge variant="info" className="min-h-7 px-2">{t('syncing')}</Badge>
                  </span>
                  <span className="rounded-full bg-ds-brand px-1.5 py-0.5 text-[9px] text-ds-brand-contrast">
                    {pendingCount}
                  </span>
                </div>
                <p className="mb-2 text-[11px] font-medium leading-relaxed text-ds-muted">
                  {t('localPending')}
                </p>
                <button
                  disabled={syncing}
                  onClick={handleTriggerSync}
                  className="min-h-11 w-full rounded-ds-sm border border-ds-brand px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-ds-brand transition-colors hover:bg-ds-brand hover:text-ds-brand-contrast focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ds-brand disabled:opacity-50"
                >
                  {syncing ? t('syncingNow') : t('syncNow')}
                </button>
              </div>
            ) : null}

            {/* Install Prompt for Android / Desktop */}
            {deferredPrompt && (
              <div className="rounded-ds-md border border-ds-border bg-ds-surface p-3 text-xs text-ds-text">
                <div className="mb-1 text-[10px] font-black uppercase tracking-wider text-ds-text">
                  ✨ {t('installApp')}
                </div>
                <p className="mb-2.5 text-[11px] font-medium leading-relaxed text-ds-muted">
                  {t('launchFullscreen', { storeName })}
                </p>
                <button
                  onClick={handleInstallApp}
                  className="flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-ds-sm bg-ds-brand px-3 py-2 text-[10px] font-black uppercase tracking-wider text-ds-brand-contrast transition-colors hover:bg-ds-brand-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ds-brand"
                >
                  <Package className="w-3.5 h-3.5" />
                  {t('installNow')}
                </button>
              </div>
            )}

            {/* Install Prompt Guide for iOS */}
            {isIOS && !isStandalone && (
              <div className="rounded-ds-md border border-ds-border bg-ds-surface p-3 text-xs text-ds-text">
                <div className="mb-1 text-[10px] font-black uppercase tracking-wider text-ds-text">
                  📲 {t('installOnIphone')}
                </div>
                <p className="text-[11px] font-medium leading-relaxed text-ds-muted">
                  {t('tapShare')}
                </p>
              </div>
            )}
          </div>

          <div className="border-t border-ds-border p-4">
            <div className="mb-3 flex items-center gap-3 px-1.5 py-1">
              <div className="flex h-[42px] w-[42px] shrink-0 items-center justify-center overflow-hidden rounded-full bg-ds-brand-soft font-display text-base font-bold text-ds-brand">
                {(userProfile?.name || userProfile?.email || 'U').slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-ds-text">{userProfile?.name || userProfile?.email || t('unknownUser')}</p>
                <p className="mt-0.5 text-xs font-medium text-ds-muted">{userProfile?.role === 'admin' ? t('administrator') : userProfile?.allowedMenus?.includes('reparation') && !userProfile.allowedMenus.includes('products') ? t('technician') : t('cashier')}</p>
              </div>
            </div>
            <button
              onClick={async () => {
                try {
                  const preferredLanguage = localStorage.getItem('app-language');
                  localStorage.clear();
                  if (preferredLanguage) localStorage.setItem('app-language', preferredLanguage);
                } catch (error) {
                  console.warn('Unable to clear local application data while preserving the language preference.', error);
                }
                try {
                  sessionStorage.clear();
                } catch (error) {
                  console.warn('Unable to clear temporary session data.', error);
                }
                await signOut(auth);
                window.location.reload();
              }}
              className="flex min-h-11 w-full items-center gap-3 rounded-ds-md px-4 py-3 text-xs font-extrabold uppercase tracking-wider text-ds-danger transition-colors hover:bg-ds-danger-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ds-danger"
            >
              <LogOut className="h-4 w-4 text-ds-muted" />
              {t('logout')}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

// Overlay bloquant affiché lorsque l'application est hors ligne :
// grise toute la page, bloque clics / focus / clavier et affiche un message.
function OfflineBlocker() {
  const { t } = useTranslation('common');
  useEffect(() => {
    // Retire le focus de tout champ actif (zone de texte, bouton...)
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    // Bloque toute saisie clavier (y compris Tab pour re-focaliser un champ)
    const blockKeys = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', blockKeys, true);
    return () => {
      window.removeEventListener('keydown', blockKeys, true);
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[9999] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 cursor-not-allowed select-none"
      onMouseDown={(e) => e.preventDefault()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-sm w-full text-center">
        <div className="mx-auto w-16 h-16 rounded-full bg-gradient-to-tr from-indigo-600 to-cyan-500 flex items-center justify-center mb-4 shadow-md shadow-indigo-600/20">
          <WifiOff className="w-8 h-8 text-white" />
        </div>
        <h2 className="text-xl font-black font-display text-slate-800 mb-2">{t('internetRequired')}</h2>
        <p className="text-slate-500 text-sm leading-relaxed">
          {t('checkInternet')}<br />
          {t('offlineBlocked')}
        </p>
      </div>
    </div>
  );
}

export default function App() {
  const { t: commonT } = useTranslation('common');
  const { t: authT } = useTranslation('auth');
  const { t: navT } = useTranslation('nav');
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [authMessage, setAuthMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [todayNotes, setTodayNotes] = useState<Note[]>([]);
  const [showNotesPopover, setShowNotesPopover] = useState(false);
  const [headerNotifications, setHeaderNotifications] = useState({ lowStock: 0, readyRepairs: 0, unpaidSales: 0, unpaidRepairs: 0 });
  const [headerNotificationError, setHeaderNotificationError] = useState('');

  // Offline status & synchronization states
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isAppInstalled, setIsAppInstalled] = useState(
    () => window.matchMedia('(display-mode: standalone)').matches || Boolean((navigator as any).standalone),
  );
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const { session: activeCashSession, loading: cashSessionLoading } = useCashSession(userProfile);

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    const handleInstalled = () => {
      setDeferredPrompt(null);
      setIsAppInstalled(true);
    };
    const handleServiceWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type === 'APP_UPDATED') setUpdateAvailable(true);
    };
    const standaloneQuery = window.matchMedia('(display-mode: standalone)');
    const handleDisplayModeChange = (event: MediaQueryListEvent) => setIsAppInstalled(event.matches);
    window.addEventListener('appinstalled', handleInstalled);
    navigator.serviceWorker?.addEventListener('message', handleServiceWorkerMessage);
    standaloneQuery.addEventListener('change', handleDisplayModeChange);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
      navigator.serviceWorker?.removeEventListener('message', handleServiceWorkerMessage);
      standaloneQuery.removeEventListener('change', handleDisplayModeChange);
    };
  }, []);

  const handleInstallApp = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  };

  useEffect(() => {
    // Initial pending count
    setPendingCount(getPendingOperations().length);

    const handleConnectionChange = () => {
      const online = navigator.onLine;
      setIsOnline(online);
      if (online) {
        handleTriggerSync();
      }
    };

    const handleQueueChange = () => {
      setPendingCount(getPendingOperations().length);
    };

    window.addEventListener('online', handleConnectionChange);
    window.addEventListener('offline', handleConnectionChange);
    window.addEventListener('offline-operations-changed', handleQueueChange);

    // Initial check and auto-sync if online on mount
    if (navigator.onLine) {
      handleTriggerSync();
    }

    return () => {
      window.removeEventListener('online', handleConnectionChange);
      window.removeEventListener('offline', handleConnectionChange);
      window.removeEventListener('offline-operations-changed', handleQueueChange);
    };
  }, [userProfile]);

  const handleTriggerSync = async () => {
    if (!navigator.onLine || !userProfile) return;
    setSyncing(true);
    setSyncError(null);
    try {
      const result = await syncPendingOperations(userProfile);
      if (!result.success && result.errors.length > 0) {
        setSyncError(result.errors.join(' | '));
      }
    } catch (e) {
      console.error('Error in synchronization cycle:', e);
    } finally {
      setSyncing(false);
      setPendingCount(getPendingOperations().length);
    }
  };

  // Dynamic date follows the selected application language.
  const getFormattedDate = () => {
    const raw = formatDateTime(new Date(), { weekday: 'long', day: 'numeric', month: 'long' });
    const locale = getDateLocale();
    return raw.charAt(0).toLocaleUpperCase(locale) + raw.slice(1);
  };

  const handleLanguageChange = async (language: AppLanguage) => {
    if (!userProfile?.uid) return;
    await updateDoc(doc(db, 'users', userProfile.uid), { preferredLanguage: language });
    setUserProfile(current => current ? { ...current, preferredLanguage: language } : current);
  };

  // Listen to today's notes
  useEffect(() => {
    if (!auth.currentUser || !user || !userProfile || !hasMenuAccess(userProfile, 'notes')) {
      setTodayNotes([]);
      return;
    }
    const ownerId = userProfile?.ownerId || userProfile?.uid || 'no_user_auth';
    const todayStr = new Date().toISOString().split('T')[0];
    
    // Listen for notes of this owner, sort client-side to avoid compound index requirements
    const q = query(collection(db, 'notes'), where('ownerId', '==', ownerId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const parsedNotes = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Note));
      
      // Sort desc client-side
      parsedNotes.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      
      // Only keep notes that match today's date
      const todays = parsedNotes.filter(n => n.date === todayStr);
      setTodayNotes(todays);
    }, (error) => {
      console.warn('Unable to refresh the notes list.');
    });

    return () => {
      unsubscribe();
    };
  }, [user, userProfile]);

  useEffect(() => {
    if (!auth.currentUser || !userProfile) {
      setHeaderNotifications({ lowStock: 0, readyRepairs: 0, unpaidSales: 0, unpaidRepairs: 0 });
      setHeaderNotificationError('');
      return;
    }
    setHeaderNotifications({ lowStock: 0, readyRepairs: 0, unpaidSales: 0, unpaidRepairs: 0 });
    setHeaderNotificationError('');

    const ownerId = userProfile.role === 'admin'
      ? userProfile.uid
      : userProfile.ownerId || userProfile.uid;
    const canViewStock = hasMenuAccess(userProfile, 'products');
    const canViewRepairs = hasMenuAccess(userProfile, 'reparation');
    const canViewSales = hasMenuAccess(userProfile, 'sales') || hasMenuAccess(userProfile, 'invoices');
    let products: Array<Record<string, any>> = [];
    let minStockAlert = 5;
    const updateLowStock = () => {
      const lowStock = products.filter(product => {
        if (product.inventoryType === 'service') return false;
        const threshold = Number.isFinite(Number(product.lowStockAlert)) && product.lowStockAlert !== undefined && product.lowStockAlert !== null
          ? Number(product.lowStockAlert)
          : minStockAlert;
        return (Number(product.stock) || 0) <= threshold;
      }).length;
      setHeaderNotifications(current => ({ ...current, lowStock }));
    };
    const subscriptions: Array<() => void> = [];

    if (canViewStock) {
      subscriptions.push(onSnapshot(
        query(collection(db, 'products'), where('ownerId', '==', ownerId)),
        snapshot => {
          products = snapshot.docs.map(item => item.data());
          updateLowStock();
        },
        () => {
          setHeaderNotificationError(commonT('stockAlertLoadError'));
          console.error('Unable to load store-scoped stock notifications.');
        },
      ));
      subscriptions.push(onSnapshot(doc(db, 'settings', ownerId), snapshot => {
        if (snapshot.exists()) {
          const configured = Number(snapshot.data().minStockAlert);
          minStockAlert = Number.isFinite(configured) && configured >= 0 ? configured : 5;
          updateLowStock();
        }
      }, () => {
        setHeaderNotificationError(commonT('stockThresholdLoadError'));
        console.error('Unable to load the store stock-alert threshold.');
      }));
    } else {
      setHeaderNotifications(current => ({ ...current, lowStock: 0 }));
    }

    if (canViewRepairs) {
      const repairsQuery = userProfile.role === 'admin'
        ? query(collection(db, 'repairs'), where('ownerId', '==', ownerId))
        : query(collection(db, 'repairs'), where('ownerId', '==', ownerId), where('costsSeparated', '==', true));
      subscriptions.push(onSnapshot(repairsQuery, snapshot => {
        const records = snapshot.docs.map(item => item.data());
        setHeaderNotifications(current => ({
          ...current,
          readyRepairs: records.filter(repair => repair.status === 'termine').length,
          unpaidRepairs: records.filter(repair => Number(repair.debt) > 0).length,
        }));
      }, () => {
        setHeaderNotificationError(commonT('repairAlertLoadError'));
        console.error('Unable to load store-scoped repair notifications.');
      }));
    } else {
      setHeaderNotifications(current => ({ ...current, readyRepairs: 0 }));
    }

    if (canViewSales) {
      subscriptions.push(onSnapshot(
        query(collection(db, 'sales'), where('ownerId', '==', ownerId)),
        snapshot => {
          setHeaderNotifications(current => ({
            ...current,
            unpaidSales: snapshot.docs.filter(item => Number(item.data().debt) > 0).length,
          }));
        },
        () => {
          setHeaderNotificationError(commonT('unpaidAlertLoadError'));
          console.error('Unable to load store-scoped unpaid-sale notifications.');
        },
      ));
    } else {
      setHeaderNotifications(current => ({ ...current, unpaidSales: 0 }));
    }

    return () => subscriptions.forEach(unsubscribe => unsubscribe());
  }, [userProfile]);

  useEffect(() => {
    let unsubscribeProfile: (() => void) | null = null;
    let isMounted = true;
    const startProfileListener = (uid: string, isFirebaseUser: boolean) => {
      if (!isFirebaseUser || !auth.currentUser) return;
      if (unsubscribeProfile) {
        unsubscribeProfile();
        unsubscribeProfile = null;
      }
      const userRef = doc(db, 'users', uid);
      unsubscribeProfile = onSnapshot(userRef, (snap) => {
        if (!isMounted) return;
        if (snap.exists()) {
          const profileData = snap.data() as UserProfile;
          if (profileData.status === 'banned') {
            if (unsubscribeProfile) {
              unsubscribeProfile();
              unsubscribeProfile = null;
            }
            setUser(null);
            setUserProfile(null);
            if (isFirebaseUser) {
              signOut(auth);
            }
            setAuthMessage(authT('errors.banned'));
            setLoading(false);
          } else {
            const repairedProfile = { ...profileData };
            if (typeof repairedProfile.preferredLanguage === 'string') {
              void setAppLanguage(
                repairedProfile.preferredLanguage === 'ar' || repairedProfile.preferredLanguage === 'fr'
                  ? repairedProfile.preferredLanguage
                  : 'fr',
              );
            }
            if (repairedProfile.role === 'admin' && repairedProfile.ownerId !== repairedProfile.uid) {
              repairedProfile.ownerId = repairedProfile.uid;
              setDoc(userRef, { ownerId: repairedProfile.uid }, { merge: true })
                .catch(() => console.error('Unable to repair the admin profile owner reference.'));
            }
            setUserProfile(repairedProfile);
          }
        }
      }, (_error) => {
        console.error('Unable to listen to the active user profile.');
      });
    };

    const unsubscribeAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!isMounted) return;

      if (firebaseUser) {
        try {
        const userRef = doc(db, 'users', firebaseUser.uid);
        const userSnap = await getDoc(userRef);
        let profileData: UserProfile;

        if (!userSnap.exists()) {
          if (!ALLOW_SELF_SIGNUP) {
            await signOut(auth);
            setUser(null);
            setUserProfile(null);
            setAuthMessage(authT('errors.unauthorizedAccount'));
            setLoading(false);
            return;
          }
          profileData = {
            uid: firebaseUser.uid,
            email: firebaseUser.email || '',
            role: 'user',
            status: 'active',
            allowedMenus: ['dashboard', 'pos', 'products', 'clients', 'sales', 'invoices'],
            ownerId: firebaseUser.uid,
            createdAt: new Date().toISOString()
          };
          await setDoc(userRef, profileData);
        } else {
          profileData = userSnap.data() as UserProfile;
          if (profileData.role === 'admin' && profileData.ownerId !== profileData.uid) {
            profileData.ownerId = profileData.uid;
            await setDoc(userRef, { ownerId: profileData.uid }, { merge: true });
          }
        }

        if (typeof profileData.preferredLanguage === 'string') {
          void setAppLanguage(
            profileData.preferredLanguage === 'ar' || profileData.preferredLanguage === 'fr'
              ? profileData.preferredLanguage
              : 'fr',
          );
        }
        setAuthMessage('');
        setUser(firebaseUser);
        setUserProfile(profileData);
        setLoading(false);
        startProfileListener(firebaseUser.uid, true);
        } catch (error) {
          console.error('Unable to load the authenticated account profile.');
          setAuthMessage(authT('errors.profileCheck'));
          await signOut(auth);
          setUser(null);
          setUserProfile(null);
          setLoading(false);
        }
      } else {
        if (unsubscribeProfile) {
          unsubscribeProfile();
          unsubscribeProfile = null;
        }
        try {
          localStorage.removeItem('custom_session');
        } catch (error) {
          console.warn('Unable to remove the obsolete session from local storage.', error);
        }
        setUser(null);
        setUserProfile(null);
        setLoading(false);
      }
    });

    return () => {
      isMounted = false;
      unsubscribeAuth();
      if (unsubscribeProfile) unsubscribeProfile();
    };
  }, []);

  const canViewHeaderNotifications = hasMenuAccess(userProfile, 'notes') ||
    hasMenuAccess(userProfile, 'products') ||
    hasMenuAccess(userProfile, 'reparation') ||
    hasMenuAccess(userProfile, 'sales') ||
    hasMenuAccess(userProfile, 'invoices');
  const canAccessCashSession = hasMenuAccess(userProfile, 'pos') || hasMenuAccess(userProfile, 'invoices');
  const canViewSalesNotifications = canAccessCashSession || hasMenuAccess(userProfile, 'sales');
  const allHeaderNotificationItems: { id: string; label: string; count: number; path: string; variant: 'warning' | 'success' | 'danger' }[] = [
    { id: 'lowStock', label: commonT('lowStockLabel'), count: headerNotifications.lowStock, path: '/products', variant: 'warning' },
    { id: 'readyRepairs', label: commonT('readyRepairsLabel'), count: headerNotifications.readyRepairs, path: '/repairs', variant: 'success' },
    { id: 'unpaid', label: commonT('unpaidLabel'), count: headerNotifications.unpaidSales + headerNotifications.unpaidRepairs, path: hasMenuAccess(userProfile, 'sales') ? '/sales' : '/repairs', variant: 'danger' },
  ];
  const headerNotificationItems = allHeaderNotificationItems.filter(item =>
    item.count > 0 && (item.id !== 'unpaid' || canViewSalesNotifications)
  );
  const headerNotificationCount = todayNotes.length + headerNotificationItems.reduce((sum, item) => sum + item.count, 0);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ds-bg">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-ds-brand"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <Login initialMessage={authMessage} />
        {!isOnline && <OfflineBlocker />}
      </>
    );
  }

  return (
    <ErrorBoundary>
      <Router>
        <StartupProvider userProfile={userProfile} online={isOnline}>
        <div className="flex min-h-screen min-w-0 bg-ds-bg" onClick={() => {
          if (showNotesPopover) setShowNotesPopover(false);
        }}>
          <Sidebar 
            isOpen={sidebarOpen} 
            setIsOpen={setSidebarOpen} 
            userProfile={userProfile} 
            todayNotesCount={todayNotes.length}
            deferredPrompt={deferredPrompt}
            handleInstallApp={handleInstallApp}
            isOnline={isOnline}
            pendingCount={pendingCount}
            syncing={syncing}
            handleTriggerSync={handleTriggerSync}
            cashSession={activeCashSession}
            cashSessionLoading={cashSessionLoading}
          />
          
          <main className="flex min-h-screen min-w-0 flex-1 flex-col lg:ps-72">
            <header className="sticky top-0 z-30 flex min-h-16 min-w-0 flex-wrap items-center justify-between gap-2 border-b border-ds-border bg-ds-surface px-3 py-2 text-ds-text sm:px-4 lg:px-8">
              <button 
                onClick={() => setSidebarOpen(true)}
                aria-label={navT('openMenu')}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-ds-md border border-ds-border bg-ds-surface text-ds-muted transition-colors hover:bg-ds-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ds-brand lg:hidden"
              >
                <Menu className="h-5 w-5" />
              </button>
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <BrandLogo variant="full" className="max-w-[min(9rem,32vw)] shrink-0" />
                <div className="min-w-0">
                  <CurrentPageTitle userProfile={userProfile} />
                  {canAccessCashSession && <p className="flex items-center gap-1.5 truncate text-[10px] font-semibold text-ds-muted lg:hidden">
                    <span className={cn("h-2 w-2 shrink-0 rounded-full", activeCashSession ? "bg-ds-success" : "bg-ds-text-muted")} />
                    {activeCashSession ? commonT('cashOpen') : cashSessionLoading ? commonT('loadingCash') : commonT('noCash')}
                  </p>}
                </div>
              </div>

              {/* Online/Offline Status Indicator */}
              <div className="hidden items-center gap-2 lg:flex">
                {isOnline ? (
                  <Badge variant="success" className="min-h-10 gap-2 uppercase tracking-[0.08em]">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-ds-success" />
                    {commonT('online')}
                  </Badge>
                ) : (
                  <Badge variant="danger" className="min-h-10 gap-2 uppercase tracking-[0.08em]">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-ds-danger" />
                    {commonT('offline')}
                  </Badge>
                )}

                {pendingCount > 0 && (
                  <button
                    onClick={handleTriggerSync}
                    disabled={syncing || !isOnline}
                    className={cn(
                      "flex min-h-11 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-wider transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ds-brand",
                      isOnline
                        ? "cursor-pointer border-ds-border bg-ds-surface text-ds-muted hover:bg-ds-surface-2"
                        : "cursor-not-allowed border-ds-border bg-ds-surface-2 text-ds-muted"
                    )}
                    title={isOnline ? commonT('syncPendingTitle') : commonT('syncOnReconnectTitle')}
                  >
                    <RefreshCcw className={cn("h-3.5 w-3.5 text-ds-brand", syncing && "animate-spin")} />
                    <span>{commonT('operationsWaitingSync', { count: pendingCount })}</span>
                  </button>
                )}
              </div>
              
              {/* Interactive Date & Notes Notification Badge widget */}
              <LanguageSelector compact className="shrink-0" onLanguageChange={handleLanguageChange} />
              <div className="relative ms-auto flex shrink-0 items-center gap-2 lg:ms-4 lg:gap-3.5" onClick={(e) => e.stopPropagation()}>
                <div className="hidden min-h-10 items-center gap-2 rounded-full border border-ds-border bg-ds-surface px-3.5 text-[11px] font-medium text-ds-muted lg:flex">
                  <Calendar className="h-4 w-4 text-ds-brand" />
                  <span>{getFormattedDate()}</span>
                </div>

                {canViewHeaderNotifications ? (
                <div className="relative">
                  <button
                    onClick={() => setShowNotesPopover(!showNotesPopover)}
                    className={cn(
                      "relative flex h-11 w-11 items-center justify-center rounded-full border transition-colors duration-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ds-brand",
                      headerNotificationCount > 0
                        ? "border-ds-border bg-ds-surface text-ds-text hover:bg-ds-surface-2"
                        : "border-ds-border bg-ds-surface text-ds-muted hover:bg-ds-surface-2"
                    )}
                    title={headerNotificationCount > 0 ? commonT('notificationCount', { count: headerNotificationCount }) : commonT('noNotifications')}
                    aria-label={headerNotificationCount ? commonT('notificationCount', { count: headerNotificationCount }) : commonT('notifications')}
                  >
                    <Bell className="h-[18px] w-[18px]" />
                    {headerNotificationCount > 0 && (
                      <span className="absolute end-1 top-1 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-ds-danger px-1 text-[10px] font-bold text-ds-brand-contrast">
                        {headerNotificationCount}
                      </span>
                    )}
                  </button>

                  {showNotesPopover && (
                    <div className="absolute end-0 z-50 mt-2.5 w-[min(20rem,calc(100vw-1.5rem))] rounded-ds-lg border border-ds-border bg-ds-surface p-4 shadow-ds-md animate-in fade-in slide-in-from-top-2 duration-200">
                      <div className="mb-2.5 flex items-center justify-between border-b border-ds-border pb-2.5">
                        <span className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-ds-text">
                          <Bell className="h-4 w-4 text-ds-brand" />
                          {commonT('notifications')}
                        </span>
                        <Badge variant="neutral" className="min-h-7 rounded-ds-sm px-2 py-0.5 text-[10px] uppercase">
                          {commonT('activeNotifications', { count: headerNotificationCount })}
                        </Badge>
                      </div>

                      <div className="max-h-56 space-y-2 overflow-y-auto pe-1">
                        {headerNotificationError && <p role="alert" className="rounded-ds-sm bg-ds-danger-soft p-2 text-[10px] font-semibold text-ds-danger">{headerNotificationError}</p>}
                        {headerNotificationItems.map(item => (
                          <Link key={item.id} to={item.path} onClick={() => setShowNotesPopover(false)}
                            className="flex min-h-11 items-center justify-between gap-3 rounded-ds-md p-2.5 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ds-brand">
                            <span className="min-w-0">{item.label}</span>
                            <Badge variant={item.variant} className="min-h-7 shrink-0 px-2">{item.count}</Badge>
                          </Link>
                        ))}
                        {hasMenuAccess(userProfile, 'notes') && (
                          <div className="border-t border-ds-border pt-2">
                            <p className="mb-2 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wide text-ds-muted"><StickyNote className="h-3.5 w-3.5 text-ds-brand" /> {commonT('memosToday')}</p>
                            {todayNotes.length === 0 ? <p className="px-1 text-[10px] text-ds-muted">{commonT('noMemosToday')}</p> : todayNotes.map(note => (
                              <div key={note.id} className="mb-2 rounded-ds-md border border-ds-border bg-ds-surface-2 p-2.5">
                                <p className="text-xs font-extrabold text-ds-text">{note.title}</p>
                                <p className="mt-1 line-clamp-3 text-[10px] leading-relaxed text-ds-muted">{note.content}</p>
                              </div>
                            ))}
                          </div>
                        )}
                        {headerNotificationItems.length === 0 && todayNotes.length === 0 && !headerNotificationError ? (
                          <div className="py-4 text-center text-ds-muted">
                            <CheckCircle className="mx-auto mb-1.5 h-7 w-7 text-ds-success" />
                            <p className="text-[10px] font-[900] uppercase tracking-wide text-ds-muted">{commonT('allClear')}</p>
                            <p className="mt-0.5 text-[9px] font-semibold text-ds-muted">{commonT('noNotificationToHandle')}</p>
                          </div>
                        ) : null}
                      </div>

                      {hasMenuAccess(userProfile, 'notes') && <div className="mt-3 border-t border-ds-border pt-2.5 text-center">
                        <Link
                          to="/notes"
                          onClick={() => setShowNotesPopover(false)}
                          className="inline-flex min-h-11 w-full items-center justify-center rounded-ds-md bg-ds-brand py-2 text-[10px] font-extrabold uppercase tracking-wider text-ds-brand-contrast transition-colors hover:bg-ds-brand-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ds-brand"
                        >
                          {commonT('manageAllMemos')}
                        </Link>
                      </div>}
                    </div>
                  )}
                </div>
                ) : (
                  <button
                    type="button"
                    aria-label={commonT('notifications')}
                    title={commonT('notifications')}
                    disabled
                    className="flex h-11 w-11 cursor-not-allowed items-center justify-center rounded-full border border-ds-border bg-ds-surface text-ds-muted"
                  >
                    <Bell className="w-4 h-4" />
                  </button>
                )}
              </div>

              {hasMenuAccess(userProfile, 'pos') && (
                <Link
                  to="/pos"
                  aria-label={commonT('openCashbox')}
                  title={commonT('openCashbox')}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-ds-md border border-ds-border bg-ds-surface text-ds-text transition-colors hover:bg-ds-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ds-brand"
                >
                  <CircleDollarSign className="h-5 w-5" />
                </Link>
              )}

              <ThemeSelector className="hidden lg:flex" />

              <div className="hidden min-w-0 items-center gap-2.5 lg:flex">
                <span className="max-w-56 whitespace-normal break-words text-xs font-medium text-ds-muted">{user.email}</span>
                <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-ds-brand-soft text-sm font-bold text-ds-brand">
                  {(user.displayName || user.email || 'U').slice(0, 1).toUpperCase()}
                </div>
              </div>
            </header>
 
            <div className="mx-auto w-full max-w-[1680px] min-w-0 flex-1 bg-ds-bg p-3 sm:p-5 lg:px-8 lg:py-7 2xl:px-12">
              <Routes>
                <Route path="/" element={getFirstAccessiblePath(userProfile) === '/' ? <Dashboard userProfile={userProfile} cashSession={activeCashSession} /> : <Navigate to={getFirstAccessiblePath(userProfile)} replace />} />
                <Route path="/products" element={hasMenuAccess(userProfile, 'products') ? <Products userProfile={userProfile} /> : <Navigate to="/" replace />} />
                <Route path="/clients" element={hasMenuAccess(userProfile, 'clients') ? <Clients userProfile={userProfile} /> : <Navigate to="/" replace />} />
                <Route path="/pos" element={hasMenuAccess(userProfile, 'pos') ? <POS userProfile={userProfile} /> : <Navigate to="/" replace />} />
                <Route path="/cash-session" element={hasMenuAccess(userProfile, 'pos') || hasMenuAccess(userProfile, 'invoices') ? <CashSession userProfile={userProfile} /> : <Navigate to="/" replace />} />
                <Route path="/sales" element={hasMenuAccess(userProfile, 'sales') ? <Sales userProfile={userProfile} /> : <Navigate to="/" replace />} />
                <Route path="/invoices" element={hasMenuAccess(userProfile, 'invoices') ? <Invoices userProfile={userProfile} /> : <Navigate to="/" replace />} />
                <Route path="/repairs" element={hasMenuAccess(userProfile, 'reparation') ? <Repairs userProfile={userProfile} /> : <Navigate to="/" replace />} />
                <Route path="/parts" element={hasMenuAccess(userProfile, 'pieces') ? <Parts userProfile={userProfile} /> : <Navigate to="/" replace />} />
                <Route path="/notes" element={hasMenuAccess(userProfile, 'notes') ? <Notes userProfile={userProfile} /> : <Navigate to="/" replace />} />
                <Route path="/users" element={userProfile?.role === 'admin' && hasMenuAccess(userProfile, 'users') ? <UsersManager userProfile={userProfile} /> : <Navigate to="/" replace />} />
                <Route path="/expenses" element={userProfile?.role === 'admin' ? <Expenses userProfile={userProfile} /> : <Navigate to="/" replace />} />
                <Route path="/reports" element={isAdminOwner(userProfile) ? <Reports userProfile={userProfile} /> : <Navigate to="/" replace />} />
                <Route path="/startup" element={<Navigate to="/settings#startup-settings" replace />} />
                {/* /settings accessible à tous : le composant Settings n'affiche que la carte "Mon code de sécurité" aux utilisateurs sans permission */}
                <Route path="/settings" element={<Settings
                  userProfile={userProfile}
                  deferredPrompt={deferredPrompt}
                  handleInstallApp={() => void handleInstallApp()}
                  isIOS={/iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream}
                  isStandalone={isAppInstalled}
                />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </div>
          </main>

          {updateAvailable && (
            <div role="status" className="fixed bottom-4 start-1/2 z-[120] flex w-[min(94vw,34rem)] -translate-x-1/2 items-center justify-between gap-3 rounded-ds-lg border border-ds-border bg-ds-surface p-3 shadow-ds-md">
              <p className="text-sm font-semibold text-ds-text">{commonT('updateAvailable')}</p>
              <button type="button" onClick={() => window.location.reload()} className="min-h-11 shrink-0 rounded-ds-md bg-ds-brand px-4 text-xs font-bold text-ds-brand-contrast hover:bg-ds-brand-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ds-brand">{commonT('refreshPage')}</button>
            </div>
          )}
          {!isOnline && <OfflineBlocker />}
        </div>
        </StartupProvider>
      </Router>
    </ErrorBoundary>
  );
}
