import React, { useState, useEffect } from 'react';
import { doc, onSnapshot, setDoc, updateDoc, collection, getDocs, query, where, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth';
import { db, auth } from '../firebase';
import { StoreSettings, UserProfile } from '../types';
import { hasMenuAccess } from '../lib/permissions';
import { Edit2, X, CheckCircle2, Store, Save, Download, Trash2, Database, AlertTriangle, Calendar, Eye, FileText, KeyRound, Lock, ShieldCheck, Music2 } from 'lucide-react';
import { cn } from '../lib/utils';
import * as XLSX from 'xlsx';
import { can } from '../lib/permissions';
import { normalizeFinancialSettings } from '../lib/financial';
import { DEFAULT_MESSAGE_TEMPLATES, MESSAGE_TEMPLATE_OPTIONS } from '../lib/messages';
import { useStartup } from './StartupProvider';
import { adhkarLibrary } from '../data/adhkar';
import { verses } from '../data/verses';
import { isDirectAudioUrl } from '../lib/startup';
import { Badge, Button, Card, Input, PageHeader, Select } from './ui';
import { useTheme, type ThemePreference } from './ThemeProvider';
import { useBrand } from './BrandProvider';
import { slugifyAppName } from '../lib/brand';
import { StartupPreferencesPanel } from './StartupPreferences';
import ActivityLog from './ActivityLog';
import { useTranslation } from 'react-i18next';

interface SettingsProps {
  userProfile: UserProfile | null;
  deferredPrompt?: any;
  handleInstallApp?: () => void;
  isIOS?: boolean;
  isStandalone?: boolean;
}

type SettingsTab = 'boutique' | 'coran-adhkar' | 'compte-securite' | 'donnees' | 'application';

function getSettingsTabFromHash(hash: string): SettingsTab | null {
  const value = hash.replace(/^#/, '');
  if (value === 'startup-settings') return 'coran-adhkar';
  return ['boutique', 'coran-adhkar', 'compte-securite', 'donnees', 'application'].includes(value)
    ? value as SettingsTab
    : null;
}

// ── Carte "Mon code de sécurité" : chaque utilisateur peut changer son propre code à 4 chiffres.
// Vérification obligatoire avant le changement : mot de passe du compte OU code reçu par email.
function SecurityCodeCard({ userProfile }: { userProfile: UserProfile | null }) {
  const [newCode, setNewCode] = useState('');
  const [confirmCode, setConfirmCode] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const onlyDigits = (v: string, max: number) => v.replace(/\D/g, '').slice(0, max);

  const validateCodes = (): boolean => {
    setError('');
    if (!/^\d{4}$/.test(newCode)) {
      setError('Le nouveau code doit contenir exactement 4 chiffres.');
      return false;
    }
    if (newCode !== confirmCode) {
      setError('La confirmation ne correspond pas au nouveau code.');
      return false;
    }
    return true;
  };

  const handleChangeCode = async () => {
    if (!validateCodes()) return;
    if (!userProfile?.uid) return;
    if (!password) {
      setError('Veuillez saisir votre mot de passe.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const currentUser = auth.currentUser;
      if (!currentUser || !currentUser.email) {
        throw new Error('Session invalide. Veuillez vous reconnecter.');
      }
      try {
        const credential = EmailAuthProvider.credential(currentUser.email, password);
        await reauthenticateWithCredential(currentUser, credential);
      } catch (authErr: any) {
        if (authErr?.code === 'auth/wrong-password' || authErr?.code === 'auth/invalid-credential' || authErr?.code === 'auth/invalid-login-credentials') {
          throw new Error('Mot de passe incorrect.');
        }
        if (authErr?.code === 'auth/too-many-requests') {
          throw new Error('Trop de tentatives. Veuillez réessayer plus tard.');
        }
        throw new Error('Vérification du mot de passe impossible. Veuillez vous reconnecter et réessayer.');
      }

      // Vérification réussie : mise à jour du code de sécurité (autorisé par les règles Firestore : auto-modification)
      await updateDoc(doc(db, 'users', userProfile.uid), { securityCode: newCode });

      setSuccessMsg('Votre code de sécurité a été modifié avec succès !');
      setNewCode('');
      setConfirmCode('');
      setPassword('');
      setTimeout(() => setSuccessMsg(''), 5000);
    } catch (err: any) {
      setError(err.message || 'Une erreur est survenue lors du changement de code.');
    } finally {
      setSaving(false);
    }
  };

  const codeInputClass = "text-center font-mono tracking-[0.5em]";

  return (
    <Card className="min-w-0 overflow-hidden p-0">
      <div className="flex items-center gap-3 border-b border-ds-border bg-ds-surface-2 p-6">
        <div className="rounded-ds-md bg-ds-brand-soft p-2 text-ds-brand">
          <KeyRound className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-ds-text">Mon Code de Sécurité</h2>
          <p className="text-xs font-bold uppercase tracking-wider text-ds-muted">Code à 4 chiffres pour les actions protégées</p>
        </div>
      </div>

      <div className="p-6 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
              label="Nouveau code (4 chiffres)"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              value={newCode}
              onChange={(e) => setNewCode(onlyDigits(e.target.value, 4))}
              className={codeInputClass}
              placeholder="••••"
            />
          <Input
              label="Confirmer le nouveau code"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              value={confirmCode}
              onChange={(e) => setConfirmCode(onlyDigits(e.target.value, 4))}
              className={codeInputClass}
              placeholder="••••"
            />
        </div>

        <div className="space-y-1.5">
          <Input
            label="Votre mot de passe"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Mot de passe de votre compte"
          />
          <p className="text-sm font-medium text-ds-muted">Votre mot de passe est requis pour confirmer le changement de code.</p>
        </div>

        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-ds-md border border-ds-danger/20 bg-ds-danger-soft p-3 text-ds-danger">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="text-sm font-semibold">{error}</p>
          </div>
        )}

        {successMsg && (
          <Badge variant="success" role="status">{successMsg}</Badge>
        )}

        <Button
          type="button"
          onClick={handleChangeCode}
          disabled={saving || newCode.length !== 4 || confirmCode.length !== 4 || !password}
          className="w-full"
        >
          <ShieldCheck className="w-4 h-4" />
          {saving ? 'Vérification...' : 'Changer mon code'}
        </Button>
      </div>
    </Card>
  );
}

function InstallAppCard({
  deferredPrompt,
  handleInstallApp,
  isIOS,
  isStandalone,
}: Pick<SettingsProps, 'deferredPrompt' | 'handleInstallApp' | 'isIOS' | 'isStandalone'>) {
  if (isStandalone || (!deferredPrompt && !isIOS)) return null;
  return (
    <Card>
      <h2 className="text-sm font-bold text-ds-text">Installer l'application</h2>
      {deferredPrompt ? (
        <Button type="button" onClick={handleInstallApp} className="mt-3">
          Installer l'application
        </Button>
      ) : (
        <p className="mt-2 text-sm leading-relaxed text-ds-muted">
          Sur iPhone ou iPad : appuyez sur Partager, puis sur Sur l’écran d’accueil.
        </p>
      )}
    </Card>
  );
}

function AccountPasswordCard() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; success: boolean } | null>(null);
  const strength = [
    newPassword.length >= 8,
    /[A-Z]/.test(newPassword) && /[a-z]/.test(newPassword),
    /\d/.test(newPassword),
    /[^A-Za-z0-9]/.test(newPassword),
  ].filter(Boolean).length;
  const strengthLabel = ['Très faible', 'Faible', 'Moyen', 'Bon', 'Fort'][strength];

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    if (newPassword.length < 8) {
      setMessage({ text: 'Le nouveau mot de passe doit contenir au moins 8 caractères.', success: false });
      return;
    }
    if (newPassword !== confirmation) {
      setMessage({ text: 'La confirmation ne correspond pas au nouveau mot de passe.', success: false });
      return;
    }

    setSaving(true);
    try {
      const currentUser = auth.currentUser;
      if (!currentUser?.email) throw new Error('Session invalide. Veuillez vous reconnecter.');
      const credential = EmailAuthProvider.credential(currentUser.email, currentPassword);
      await reauthenticateWithCredential(currentUser, credential);
      await updatePassword(currentUser, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmation('');
      setMessage({ text: 'Votre mot de passe a été modifié.', success: true });
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : '';
      const text = code === 'auth/wrong-password' || code === 'auth/invalid-credential'
        ? 'Le mot de passe actuel est incorrect.'
        : code === 'auth/weak-password'
          ? 'Choisissez un mot de passe plus robuste.'
          : error instanceof Error
            ? error.message
            : 'Impossible de modifier le mot de passe.';
      setMessage({ text, success: false });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="min-w-0 overflow-hidden p-0">
      <div className="flex items-center gap-3 border-b border-ds-border bg-ds-surface-2 p-6">
        <div className="rounded-ds-md bg-ds-brand-soft p-2 text-ds-brand"><Lock className="w-5 h-5" /></div>
        <div>
          <h2 className="text-sm font-bold text-ds-text">Mon compte</h2>
          <p className="text-xs font-bold uppercase tracking-wider text-ds-muted">Changer mon mot de passe</p>
        </div>
      </div>
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        <Input label="Mot de passe actuel" type="password" autoComplete="current-password" required value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} />
        <Input label="Nouveau mot de passe" type="password" autoComplete="new-password" required minLength={8} value={newPassword} onChange={event => setNewPassword(event.target.value)} />
        <div aria-live="polite" className="space-y-1">
          <div className="flex gap-1" aria-hidden="true">
            {[1, 2, 3, 4].map(level => <span key={level} className={`h-1.5 flex-1 rounded-full ${strength >= level ? (strength <= 1 ? 'bg-ds-danger' : strength === 2 ? 'bg-ds-warning' : 'bg-ds-success') : 'bg-ds-surface-2'}`} />)}
          </div>
          <p className="text-sm text-ds-muted">Force : {newPassword ? strengthLabel : '—'} · 8 caractères minimum</p>
        </div>
        <Input label="Confirmer le nouveau mot de passe" type="password" autoComplete="new-password" required minLength={8} value={confirmation} onChange={event => setConfirmation(event.target.value)} />
        {message && <Badge variant={message.success ? 'success' : 'danger'} role={message.success ? 'status' : 'alert'} className="min-h-0 rounded-ds-md">{message.text}</Badge>}
        <Button type="submit" disabled={saving || !currentPassword || newPassword.length < 8 || newPassword !== confirmation}>
          {saving ? 'Modification…' : 'Changer mon mot de passe'}
        </Button>
      </form>
    </Card>
  );
}

function SettingsContent({
  userProfile,
  deferredPrompt,
  handleInstallApp,
  isIOS,
  isStandalone,
}: SettingsProps) {
  const { t } = useTranslation('settings');
  const [storeSettings, setStoreSettings] = useState<StoreSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState<string | null>(null);
  const [firestoreError, setFirestoreError] = useState<string | null>(null);
  const { theme, setTheme } = useTheme();
  const brand = useBrand();

  const ownerId = (userProfile?.role === 'admin' ? userProfile?.uid : userProfile?.ownerId) || userProfile?.uid || auth.currentUser?.uid;
  const {
    config: startupConfig,
    canManage: canManageStartup,
    personalPreferences,
    updatePersonalPreferences,
  } = useStartup();
  const canAccessStoreSettings = hasMenuAccess(userProfile, 'settings');
  const isAdmin = userProfile?.role === 'admin';
  const isTabAvailable = (tab: SettingsTab) => {
    if (tab === 'compte-securite' || tab === 'application') return true;
    if (tab === 'coran-adhkar') return true;
    if (tab === 'donnees') return isAdmin;
    return canAccessStoreSettings;
  };
  const [activeTab, setActiveTab] = useState<SettingsTab>(() => {
    const requestedTab = getSettingsTabFromHash(window.location.hash);
    if (requestedTab && isTabAvailable(requestedTab)) return requestedTab;
    return canAccessStoreSettings ? 'boutique' : 'compte-securite';
  });
  const [startupEnabled, setStartupEnabled] = useState(startupConfig.enabled);
  const [welcomeTitle, setWelcomeTitle] = useState(startupConfig.welcomeTitle || verses[0].title);
  const [welcomeText, setWelcomeText] = useState(startupConfig.welcomeText || verses[0].text);
  const [welcomeSource, setWelcomeSource] = useState(startupConfig.welcomeSource || verses[0].source);
  const [startupAudioUrl, setStartupAudioUrl] = useState(startupConfig.audioUrl || '');
  const [startupSaving, setStartupSaving] = useState(false);
  const [startupMessage, setStartupMessage] = useState('');
  const [startupAudioTestMessage, setStartupAudioTestMessage] = useState('');
  const [storeFormData, setStoreFormData] = useState({
    storeName: brand.storeName,
    storeTagline: brand.storeTagline,
    logo: brand.logo,
    currency: '',
    address: '',
    phone: '',
    whatsappCountryCode: '216',
    messageTemplates: { ...DEFAULT_MESSAGE_TEMPLATES },
    tva: 0,
    tvaEnabled: false,
    sellerMentionMode: 'initial',
    deleteCode: '',
    minStockAlert: 5
  });
  const [isExporting, setIsExporting] = useState(false);
  const [isPurging, setIsPurging] = useState(false);
  const [purgeDate, setPurgeDate] = useState('');
  const [purgeSales, setPurgeSales] = useState(true);
  const [purgeInvoices, setPurgeInvoices] = useState(true);
  const [activityStartDate, setActivityStartDate] = useState('');
  const [activityEndDate, setActivityEndDate] = useState('');
  const [isGeneratingActivity, setIsGeneratingActivity] = useState(false);
  const [activityError, setActivityError] = useState('');
  const [showActivityLogModal, setShowActivityLogModal] = useState(false);
  const [activityLogLines, setActivityLogLines] = useState<string[]>([]);
  const [isLoadingActivityView, setIsLoadingActivityView] = useState(false);
  const startupAudioPreview = React.useRef<HTMLAudioElement>(null);
  const welcomeChoices = [
    ...verses.map((verse) => ({ id: `verse:${verse.title}`, ...verse })),
    ...adhkarLibrary.map((adhkar) => ({ id: `dhikr:${adhkar.section}:${adhkar.title}`, ...adhkar })),
  ];
  const selectedWelcomeChoice = welcomeChoices.find(
    (choice) => choice.title === welcomeTitle && choice.text === welcomeText,
  )?.id || 'custom';

  useEffect(() => {
    const syncTabWithHash = () => {
      const requestedTab = getSettingsTabFromHash(window.location.hash);
      if (requestedTab && isTabAvailable(requestedTab)) setActiveTab(requestedTab);
    };
    window.addEventListener('hashchange', syncTabWithHash);
    syncTabWithHash();
    return () => window.removeEventListener('hashchange', syncTabWithHash);
  }, [canAccessStoreSettings, canManageStartup, isAdmin]);

  useEffect(() => {
    if (!isTabAvailable(activeTab)) {
      setActiveTab(canAccessStoreSettings ? 'boutique' : 'compte-securite');
    }
  }, [activeTab, canAccessStoreSettings, canManageStartup, isAdmin]);

  useEffect(() => {
    setStartupEnabled(startupConfig.enabled);
    setWelcomeTitle(startupConfig.welcomeTitle || verses[0].title);
    setWelcomeText(startupConfig.welcomeText || verses[0].text);
    setWelcomeSource(startupConfig.welcomeSource || verses[0].source);
    setStartupAudioUrl(startupConfig.audioUrl || '');
  }, [
    startupConfig.enabled,
    startupConfig.welcomeTitle,
    startupConfig.welcomeText,
    startupConfig.welcomeSource,
    startupConfig.audioUrl,
  ]);

  const saveStartupSettings = async () => {
    if (!canManageStartup) {
      setStartupMessage('Vous n’êtes pas autorisé à modifier ces réglages.');
      return;
    }
    if (!ownerId) {
      setStartupMessage('Propriétaire du magasin introuvable.');
      return;
    }
    if (!welcomeTitle.trim() || !welcomeText.trim()) {
      setStartupMessage('Le titre et le texte sont obligatoires.');
      return;
    }
    if (startupAudioUrl && !isDirectAudioUrl(startupAudioUrl)) {
      setStartupMessage('Utilisez un lien HTTPS direct vers un fichier .mp3, .m4a, .ogg ou .wav.');
      return;
    }

    setStartupSaving(true);
    setStartupMessage('');
    try {
      await setDoc(doc(db, 'startup_config', ownerId), {
        ownerId,
        ...startupConfig,
        enabled: startupEnabled,
        welcomeTitle: welcomeTitle.trim(),
        welcomeText: welcomeText.trim(),
        welcomeSource: welcomeSource.trim(),
        audioUrl: startupAudioUrl.trim(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      setStartupMessage('Réglages Coran & Adhkar enregistrés.');
    } catch (saveError) {
      console.error('Unable to save startup settings:', saveError);
      setStartupMessage('Impossible d’enregistrer les réglages. Vérifiez les permissions Firestore.');
    } finally {
      setStartupSaving(false);
    }
  };

  const testStartupAudio = () => {
    setStartupAudioTestMessage('');
    if (!isDirectAudioUrl(startupAudioUrl)) {
      setStartupAudioTestMessage('Lien audio invalide : fournissez une URL HTTPS directe en .mp3, .m4a, .ogg ou .wav.');
      return;
    }
    const audio = startupAudioPreview.current;
    if (!audio) {
      setStartupAudioTestMessage('Lecteur audio indisponible.');
      return;
    }
    audio.currentTime = 0;
    void audio.play().then(() => {
      setStartupAudioTestMessage('Lecture audio démarrée.');
    }).catch(() => {
      setStartupAudioTestMessage('Fichier illisible ou inaccessible. Vérifiez le lien direct et les autorisations CORS de l’hébergeur.');
    });
  };

  const todayStr = new Date().toISOString().split('T')[0];

  const validateActivityRange = (): { start: Date; end: Date } | null => {
    setActivityError('');

    if (!activityStartDate || !activityEndDate) {
      setActivityError('Veuillez sélectionner une date de début et une date de fin.');
      return null;
    }

    const start = new Date(activityStartDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(activityEndDate);
    end.setHours(23, 59, 59, 999);

    if (end < start) {
      setActivityError('La date de fin doit être postérieure ou égale à la date de début.');
      return null;
    }

    const diffDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays > 31) {
      setActivityError('La période sélectionnée ne peut pas dépasser 1 mois (31 jours maximum).');
      return null;
    }

    return { start, end };
  };

  const toJsDate = (d: any): Date | null => {
    if (!d) return null;
    if (typeof d.toDate === 'function') return d.toDate();
    const parsed = new Date(d);
    return isNaN(parsed.getTime()) ? null : parsed;
  };

  const fetchActivityRecords = async (start: Date, end: Date) => {
    if (!isAdmin || !ownerId) throw new Error('Accès administrateur requis.');
    let salesSnap;
    let invoicesSnap;
    let auditLogsSnap;
    try {
      [salesSnap, invoicesSnap, auditLogsSnap] = await Promise.all([
        getDocs(query(collection(db, 'sales'), where('ownerId', '==', ownerId))),
        getDocs(query(collection(db, 'invoices'), where('ownerId', '==', ownerId))),
        getDocs(query(collection(db, 'audit_logs'), where('ownerId', '==', ownerId))),
      ]);
    } catch (error) {
      console.error('Unable to load activity records:', error);
      setFirestoreError('Impossible de charger le journal d’activité. Vérifiez vos autorisations Firestore.');
      throw error;
    }

    const salesInRange = salesSnap.docs
      .map(d => ({ id: d.id, ...d.data() } as any))
      .filter(s => { const dt = toJsDate(s.date); return !!dt && dt >= start && dt <= end; })
      .sort((a, b) => toJsDate(a.date)!.getTime() - toJsDate(b.date)!.getTime());

    const invoicesInRange = invoicesSnap.docs
      .map(d => ({ id: d.id, ...d.data() } as any))
      .filter(inv => { const dt = toJsDate(inv.date); return !!dt && dt >= start && dt <= end; })
      .sort((a, b) => toJsDate(a.date)!.getTime() - toJsDate(b.date)!.getTime());

    const auditLogsInRange = auditLogsSnap.docs
      .map(d => ({ id: d.id, ...d.data() } as any))
      .filter(l => { const dt = toJsDate(l.timestamp); return !!dt && dt >= start && dt <= end; })
      .sort((a, b) => toJsDate(a.timestamp)!.getTime() - toJsDate(b.timestamp)!.getTime());

    return { salesInRange, invoicesInRange, auditLogsInRange };
  };

  const actionLabels: Record<string, string> = {
    CREATE_PRODUCT: 'Création de produit',
    UPDATE_PRODUCT: 'Modification de produit',
    DELETE_PRODUCT: 'Suppression de produit',
    DELETE_SALE: 'Suppression de vente'
  };

  const handleDownloadActivityLog = async () => {
    if (!isAdmin || !ownerId) {
      setFirestoreError('Cette action est réservée à l’administrateur du magasin.');
      return;
    }
    const range = validateActivityRange();
    if (!range) return;
    const { start, end } = range;

    setIsGeneratingActivity(true);
    try {
      const { salesInRange, invoicesInRange, auditLogsInRange } = await fetchActivityRecords(start, end);

      if (salesInRange.length === 0 && invoicesInRange.length === 0 && auditLogsInRange.length === 0) {
        setActivityError('Aucune activité trouvée pour la période sélectionnée.');
        setIsGeneratingActivity(false);
        return;
      }

      const fmtDateTime = (dt: Date) => `${dt.toLocaleDateString('fr-FR')} ${dt.toLocaleTimeString('fr-FR')}`;

      const journalOperations = auditLogsInRange.map(l => {
        const dt = toJsDate(l.timestamp);
        let details = '';
        if (l.action === 'DELETE_SALE') {
          details = `Ticket ${l.ticketId || ''} — Facture ${l.invoiceNumber || 'N/A'} — Total ${l.total || 0} DT`;
        } else if (l.productName) {
          details = `Produit : ${l.productName}`;
        }
        return {
          'Date & Heure': dt ? fmtDateTime(dt) : '',
          'Opération': actionLabels[l.action] || l.action || 'N/A',
          'Utilisateur': l.userName && l.userName !== 'unknown' ? l.userName : (l.userEmail || 'N/A'),
          'Détails': details
        };
      });

      const journalVentes = salesInRange.map(s => {
        const dt = toJsDate(s.date);
        const itemsString = s.items ? s.items.map((it: any) => `${it.name} (${it.quantity} x ${it.price} DT)`).join(', ') : '';
        return {
          'Date & Heure': dt ? fmtDateTime(dt) : '',
          'Référence': s.id,
          'Client': s.clientName || 'Client de passage',
          'Total TTC (DT)': s.total || 0,
          'Payé (DT)': s.paid || 0,
          'Dette (DT)': s.debt || 0,
          ...(storeFormData.tvaEnabled ? { 'TVA (DT)': s.tva || 0 } : {}),
          'Facture associée': s.invoiceId || 'N/A',
          'Détail des articles': itemsString
        };
      });

      const journalFactures = invoicesInRange.map(inv => {
        const dt = toJsDate(inv.date);
        const itemsString = inv.items ? inv.items.map((it: any) => `${it.name} (${it.quantity} x ${it.price} DT)`).join(', ') : '';
        return {
          'Date & Heure': dt ? fmtDateTime(dt) : '',
          'Numéro de facture': inv.number || inv.id,
          'Client': inv.clientName || '',
          'Téléphone': inv.clientPhone || '',
          'Total TTC (DT)': inv.total || 0,
          'Payé (DT)': inv.paid || 0,
          'Dette (DT)': inv.debt || 0,
          ...(storeFormData.tvaEnabled ? { 'TVA (DT)': inv.tva || 0 } : {}),
          'Détail des articles': itemsString
        };
      });

      const totalCA = salesInRange.reduce((sum, s) => sum + (s.total || 0), 0);
      const totalPaye = salesInRange.reduce((sum, s) => sum + (s.paid || 0), 0);
      const totalDette = salesInRange.reduce((sum, s) => sum + (s.debt || 0), 0);
      const totalTva = storeFormData.tvaEnabled
        ? salesInRange.reduce((sum, s) => sum + (s.tva || 0), 0)
        : 0;

      const resume = [
        { 'Indicateur': 'Magasin', 'Valeur': storeFormData.storeName || 'Magasin' },
        { 'Indicateur': 'Période', 'Valeur': `Du ${start.toLocaleDateString('fr-FR')} au ${end.toLocaleDateString('fr-FR')}` },
        { 'Indicateur': 'Nombre de ventes', 'Valeur': salesInRange.length },
        { 'Indicateur': 'Nombre de factures', 'Valeur': invoicesInRange.length },
        { 'Indicateur': 'Nombre d\'opérations (produits, suppressions...)', 'Valeur': auditLogsInRange.length },
        { 'Indicateur': "Chiffre d'affaires total (DT)", 'Valeur': totalCA.toFixed(2) },
        { 'Indicateur': 'Total encaissé (DT)', 'Valeur': totalPaye.toFixed(2) },
        { 'Indicateur': 'Total dettes générées (DT)', 'Valeur': totalDette.toFixed(2) },
        ...(storeFormData.tvaEnabled
          ? [{ 'Indicateur': 'Total TVA collectée (DT)', 'Valeur': totalTva.toFixed(3) }]
          : []),
        { 'Indicateur': 'Date de génération', 'Valeur': fmtDateTime(new Date()) }
      ];

      const wb = XLSX.utils.book_new();
      const resumeSheet = XLSX.utils.json_to_sheet(resume);
      const ventesSheet = XLSX.utils.json_to_sheet(journalVentes);
      const facturesSheet = XLSX.utils.json_to_sheet(journalFactures);
      const operationsSheet = XLSX.utils.json_to_sheet(journalOperations);

      XLSX.utils.book_append_sheet(wb, resumeSheet, 'Résumé');
      XLSX.utils.book_append_sheet(wb, ventesSheet, 'Ventes');
      XLSX.utils.book_append_sheet(wb, facturesSheet, 'Factures');
      XLSX.utils.book_append_sheet(wb, operationsSheet, 'Opérations');

      const fileName = `${slugifyAppName(brand.storeName)}-journal-activite_${activityStartDate}_au_${activityEndDate}.xlsx`;
      XLSX.writeFile(wb, fileName);

      setSuccess('Journal d\'activité téléchargé avec succès !');
      setTimeout(() => setSuccess(null), 3000);
    } catch (error) {
      console.error('Unable to download activity records:', error);
      setActivityError('Impossible de télécharger le journal d’activité. Vérifiez vos autorisations Firestore.');
    } finally {
      setIsGeneratingActivity(false);
    }
  };

  const handleViewActivityLog = async () => {
    if (!isAdmin || !ownerId) {
      setFirestoreError('Cette action est réservée à l’administrateur du magasin.');
      return;
    }
    const range = validateActivityRange();
    if (!range) return;
    const { start, end } = range;

    setIsLoadingActivityView(true);
    try {
      const { salesInRange, invoicesInRange, auditLogsInRange } = await fetchActivityRecords(start, end);

      if (salesInRange.length === 0 && invoicesInRange.length === 0 && auditLogsInRange.length === 0) {
        setActivityError('Aucune activité trouvée pour la période sélectionnée.');
        setIsLoadingActivityView(false);
        return;
      }

      const fmtDateTime = (dt: Date) => `${dt.toLocaleDateString('fr-FR')} ${dt.toLocaleTimeString('fr-FR')}`;

      type LogLine = { dt: Date; text: string };
      const lines: LogLine[] = [];

      salesInRange.forEach(s => {
        const dt = toJsDate(s.date);
        if (!dt) return;
        const client = s.clientName || 'Client de passage';
        lines.push({ dt, text: `[${fmtDateTime(dt)}] VENTE      | Réf ${s.id} | Client: ${client} | Total: ${(s.total || 0).toFixed(2)} DT | Payé: ${(s.paid || 0).toFixed(2)} DT | Dette: ${(s.debt || 0).toFixed(2)} DT` });
      });

      invoicesInRange.forEach(inv => {
        const dt = toJsDate(inv.date);
        if (!dt) return;
        lines.push({ dt, text: `[${fmtDateTime(dt)}] FACTURE    | N° ${inv.number || inv.id} | Client: ${inv.clientName || 'N/A'} | Total: ${(inv.total || 0).toFixed(2)} DT` });
      });

      auditLogsInRange.forEach(l => {
        const dt = toJsDate(l.timestamp);
        if (!dt) return;
        const label = (actionLabels[l.action] || l.action || 'OPÉRATION').toUpperCase();
        const user = l.userName && l.userName !== 'unknown' ? l.userName : (l.userEmail || 'N/A');
        let details = '';
        if (l.action === 'DELETE_SALE') {
          details = `Ticket ${l.ticketId || ''} | Facture ${l.invoiceNumber || 'N/A'} | Total: ${(l.total || 0).toFixed(2)} DT`;
        } else if (l.productName) {
          details = `Produit: ${l.productName}`;
        }
        lines.push({ dt, text: `[${fmtDateTime(dt)}] ${label.padEnd(10, ' ')} | Par: ${user} | ${details}` });
      });

      lines.sort((a, b) => a.dt.getTime() - b.dt.getTime());

      setActivityLogLines(lines.map(l => l.text));
      setShowActivityLogModal(true);
    } catch (error) {
      console.error('Unable to display activity records:', error);
      setActivityError('Impossible d’afficher le journal d’activité. Vérifiez vos autorisations Firestore.');
    } finally {
      setIsLoadingActivityView(false);
    }
  };

  const handleExportExcel = async () => {
    if (!isAdmin || !ownerId) {
      setFirestoreError('Cette action est réservée à l’administrateur du magasin.');
      return;
    }
    setIsExporting(true);
    try {
      const isAdmin = userProfile?.role === 'admin';
      const canViewProductBuyPrice = can(userProfile, 'products', 'viewBuyPrice');
      const [productsSnap, clientsSnap, salesSnap, invoicesSnap, productCostsSnap] = await Promise.all([
        getDocs(query(collection(db, 'products'), where('ownerId', '==', ownerId))),
        getDocs(query(collection(db, 'clients'), where('ownerId', '==', ownerId))),
        getDocs(query(collection(db, 'sales'), where('ownerId', '==', ownerId))),
        getDocs(query(collection(db, 'invoices'), where('ownerId', '==', ownerId))),
        canViewProductBuyPrice
          ? getDocs(query(collection(db, 'product_costs'), where('ownerId', '==', ownerId)))
          : Promise.resolve(null),
      ]);
      const productCosts = Object.fromEntries(
        productCostsSnap?.docs.map(item => [item.id, Number(item.data().buyPrice) || 0]) || []
      );

      const productsData = productsSnap.docs.map(doc => {
        const d = doc.data();
        return {
          'ID Produit': doc.id,
          'Nom de l\'article': d.name || '',
          'Catégorie': d.category || '',
          ...(canViewProductBuyPrice ? { 'Prix d\'achat (DT)': productCosts[doc.id] ?? (isAdmin ? Number(d.buyPrice) || 0 : 0) } : {}),
          'Prix de vente (DT)': d.sellPrice || 0,
          'Code à barre': d.barcode || '',
          'Stock restant': d.stock || 0,
          'Alerte Stock Bas': d.lowStockAlert || 0,
          'Date d\'expiration': d.expirationDate || ''
        };
      });

      const clientsData = clientsSnap.docs.map(doc => {
        const d = doc.data();
        return {
          'ID Client': doc.id,
          'Code Client': d.code || '',
          'Nom complet': d.name || '',
          'Téléphone': d.phone || '',
          'Adresse': d.address || '',
          'Dette Actuelle (DT)': d.debt || 0
        };
      });

      const salesData = salesSnap.docs.map(doc => {
        const d = doc.data();
        let formattedDate = '';
        if (d.date) {
          if (d.date.toDate) formattedDate = d.date.toDate().toLocaleDateString('fr-FR') + ' ' + d.date.toDate().toLocaleTimeString('fr-FR');
          else formattedDate = String(d.date);
        }
        const itemsString = d.items ? d.items.map((it: any) => `${it.name} (${it.quantity} x ${it.price} DT)`).join(', ') : '';
        return {
          'ID de la Vente': doc.id,
          'Date': formattedDate,
          'Client': d.clientName || 'Client de passage',
          'Total TTC (DT)': d.total || 0,
          'Montant payé (DT)': d.paid || 0,
          'Dette restante (DT)': d.debt || 0,
          ...(storeFormData.tvaEnabled ? { 'Montant TVA (DT)': d.tva || 0 } : {}),
          'ID Facture associée': d.invoiceId || 'N/A',
          'Détail des Articles': itemsString
        };
      });

      const invoicesData = invoicesSnap.docs.map(doc => {
        const d = doc.data();
        let formattedDate = '';
        if (d.date) {
          if (d.date.toDate) formattedDate = d.date.toDate().toLocaleDateString('fr-FR') + ' ' + d.date.toDate().toLocaleTimeString('fr-FR');
          else formattedDate = String(d.date);
        }
        const itemsString = d.items ? d.items.map((it: any) => `${it.name} (${it.quantity} x ${it.price} DT)`).join(', ') : '';
        return {
          'ID de la Facture': doc.id,
          'Numéro de Facture': d.number || '',
          'ID de la Vente': d.saleId || '',
          'Nom Client': d.clientName || '',
          'Téléphone Client': d.clientPhone || '',
          'Adresse Client': d.clientAddress || '',
          'Total Facture (DT)': d.total || 0,
          'Payé (DT)': d.paid || 0,
          'Dette (DT)': d.debt || 0,
          ...(storeFormData.tvaEnabled ? { 'TVA (DT)': d.tva || 0 } : {}),
          'Date de Facturation': formattedDate,
          'Articles': itemsString
        };
      });

      const wb = XLSX.utils.book_new();

      const productsSheet = XLSX.utils.json_to_sheet(productsData);
      const clientsSheet = XLSX.utils.json_to_sheet(clientsData);
      const salesSheet = XLSX.utils.json_to_sheet(salesData);
      const invoicesSheet = XLSX.utils.json_to_sheet(invoicesData);

      XLSX.utils.book_append_sheet(wb, productsSheet, 'Produits');
      XLSX.utils.book_append_sheet(wb, clientsSheet, 'Clients');
      XLSX.utils.book_append_sheet(wb, salesSheet, 'Ventes');
      XLSX.utils.book_append_sheet(wb, invoicesSheet, 'Factures');

      const fileName = `${slugifyAppName(brand.storeName)}-export-base_${(storeFormData.storeName || 'Magasin').replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`;
      XLSX.writeFile(wb, fileName);

      setSuccess('Base de données exportée en fichier Excel avec succès !');
      setTimeout(() => setSuccess(null), 4000);
    } catch (error) {
      console.error('Erreur export :', error);
      setFirestoreError('Impossible d’exporter les données. Vérifiez vos autorisations Firestore.');
    } finally {
      setIsExporting(false);
    }
  };

  const handlePurgeDatabase = async () => {
    if (!isAdmin || !ownerId) {
      setFirestoreError('Cette action est réservée à l’administrateur du magasin.');
      return;
    }
    if (!purgeDate) {
      alert("Veuillez sélectionner une date limite.");
      return;
    }

    const limitDate = new Date(purgeDate);
    limitDate.setHours(23, 59, 59, 999);

    const checkConfirm = window.confirm(
      `ATTENTION : Vous allez supprimer TOUTES les transactions antérieures au ${limitDate.toLocaleDateString('fr-FR')} incluse.\n\nCette action est irréversible et supprimera définitivement les données sélectionnées.\n\nÊtes-vous absolument sûr ?`
    );

    if (!checkConfirm) {
      return;
    }

    const confirmationInput = prompt(
      `Pour confirmer la suppression et l'allègement de la base, veuillez écrire le mot PURGER en majuscules :`
    );

    if (confirmationInput !== 'PURGER') {
      alert("Purge annulée. La confirmation tapée est incorrecte.");
      return;
    }

    setIsPurging(true);
    try {
      let salesDeleted = 0;
      let invoicesDeleted = 0;

      if (purgeSales) {
        const salesQuery = query(collection(db, 'sales'), where('ownerId', '==', ownerId), where('date', '<=', limitDate));
        const salesSnap = await getDocs(salesQuery);
        for (const docSnap of salesSnap.docs) {
          await deleteDoc(docSnap.ref);
          salesDeleted++;
        }
      }

      if (purgeInvoices) {
        const invoicesQuery = query(collection(db, 'invoices'), where('ownerId', '==', ownerId), where('date', '<=', limitDate));
        const invoicesSnap = await getDocs(invoicesQuery);
        for (const docSnap of invoicesSnap.docs) {
          await deleteDoc(docSnap.ref);
          invoicesDeleted++;
        }
      }

      setSuccess(`Purge complétée ! ${salesDeleted} ventes et ${invoicesDeleted} factures antérieures au ${limitDate.toLocaleDateString('fr-FR')} ont été définitivement nettoyées.`);
      setTimeout(() => setSuccess(null), 5000);
    } catch (error) {
      console.error('Erreur purge:', error);
      setFirestoreError('Impossible de purger les données. Vérifiez vos autorisations Firestore.');
    } finally {
      setIsPurging(false);
    }
  };

  useEffect(() => {
    if (!canAccessStoreSettings) {
      setLoading(false);
      return;
    }
    if (!auth.currentUser || !ownerId) {
      setLoading(false);
      setFirestoreError('Impossible d’identifier le magasin pour charger ses paramètres.');
      return;
    }
    setLoading(true);
    setFirestoreError(null);
    const unsubscribeStore = onSnapshot(doc(db, 'settings', ownerId), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data() as StoreSettings;
        const financialSettings = normalizeFinancialSettings(data);
        setStoreSettings({ ...data, ...financialSettings, id: snapshot.id });
        setStoreFormData({
          storeName: data.storeName || brand.storeName,
          storeTagline: data.storeTagline || '',
          logo: data.logo || '',
          currency: data.currency || '',
          address: data.address || '',
          phone: data.phone || '',
          whatsappCountryCode: data.whatsappCountryCode || '216',
          messageTemplates: { ...DEFAULT_MESSAGE_TEMPLATES, ...data.messageTemplates },
          tva: financialSettings.tva || 0,
          tvaEnabled: financialSettings.tvaEnabled === true,
          sellerMentionMode: data.sellerMentionMode || 'initial',
          deleteCode: data.deleteCode || '',
          minStockAlert: data.minStockAlert !== undefined ? data.minStockAlert : 5
        });
      } else {
        setStoreSettings({
          id: ownerId,
          storeName: brand.storeName,
          storeTagline: brand.storeTagline,
          logo: brand.logo,
          currency: 'DT',
          tva: 0,
          tvaEnabled: false,
          sellerMentionMode: 'initial',
          minStockAlert: 5
        } as StoreSettings);
        setStoreFormData({
          storeName: brand.storeName,
          storeTagline: brand.storeTagline,
          logo: brand.logo,
          currency: 'DT',
          address: '',
          phone: '',
          whatsappCountryCode: '216',
          messageTemplates: { ...DEFAULT_MESSAGE_TEMPLATES },
          tva: 0,
          tvaEnabled: false,
          sellerMentionMode: 'initial',
          deleteCode: '',
          minStockAlert: 5
        });
      }
      setLoading(false);
    }, (error) => {
      console.error('Unable to load store settings:', error);
      setFirestoreError('Impossible de charger les paramètres du magasin. Vérifiez vos autorisations Firestore.');
      setLoading(false);
    });

    return () => {
      unsubscribeStore();
    };
  }, [ownerId, canAccessStoreSettings, brand.storeName, brand.storeTagline, brand.logo]);

  const handleStoreSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canAccessStoreSettings || !ownerId) {
      setFirestoreError('Vous n’êtes pas autorisé à modifier les paramètres du magasin.');
      return;
    }
    setFirestoreError(null);
    try {
      await setDoc(doc(db, 'settings', ownerId), {
        ...storeFormData,
        tvaOptIn: storeFormData.tvaEnabled,
      }, { merge: true });
      setSuccess('Paramètres du magasin enregistrés avec succès !');
      setTimeout(() => setSuccess(null), 3000);
    } catch (error) {
      console.error('Unable to save store settings:', error);
      setFirestoreError('Impossible d’enregistrer les paramètres du magasin. Vérifiez vos autorisations Firestore.');
    }
  };

  const settingsTabs: { id: SettingsTab; label: string }[] = [
    ...(canAccessStoreSettings ? [{ id: 'boutique' as const, label: 'Boutique' }] : []),
    { id: 'coran-adhkar', label: 'Coran & Adhkar' },
    { id: 'compte-securite', label: 'Compte & sécurité' },
    ...(isAdmin ? [{ id: 'donnees' as const, label: 'Données' }] : []),
    { id: 'application', label: 'Application' },
  ];

  const selectSettingsTab = (tab: SettingsTab) => {
    setActiveTab(tab);
    window.location.hash = tab;
  };

  return (
    <div className="mx-auto w-full min-w-0 max-w-4xl space-y-6">
      <PageHeader
        title={canAccessStoreSettings ? 'Paramètres du Magasin' : 'Paramètres'}
        description={canAccessStoreSettings
          ? "Configurez les informations d'en-tête, la devise, les coordonnées de contact et la gestion de la TVA."
          : 'Gérez votre compte et les paramètres de l’application.'}
      />

      {(firestoreError || brand.error) && (
        <div role="alert" className="rounded-ds-md border border-ds-danger/20 bg-ds-danger-soft p-3 text-sm font-semibold text-ds-danger">
          {firestoreError || brand.error}
        </div>
      )}

      {loading ? (
        <Card className="flex items-center justify-center p-16">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-ds-brand" />
        </Card>
      ) : (
        <div className="min-w-0 space-y-6">
          <div className="sticky top-16 z-20 -mx-3 min-w-0 max-w-full bg-ds-bg px-3 py-2 sm:-mx-4 sm:px-4" role="tablist" aria-label="Sections des paramètres">
            <div className="flex min-w-0 max-w-full gap-2 overflow-x-auto rounded-ds-lg border border-ds-border bg-ds-surface p-1">
              {settingsTabs.map(({ id, label }) => (
                <Button
                  key={id}
                  type="button"
                  variant={activeTab === id ? 'primary' : 'ghost'}
                  role="tab"
                  id={`settings-tab-${id}`}
                  aria-controls={`settings-panel-${id}`}
                  aria-selected={activeTab === id}
                  onClick={() => selectSettingsTab(id)}
                  className="min-h-ds-touch-target shrink-0 rounded-ds-md px-4 text-xs"
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>

          <section
            id="settings-panel-compte-securite"
            role="tabpanel"
            aria-labelledby="settings-tab-compte-securite"
            tabIndex={0}
            className={cn('grid min-w-0 grid-cols-1 items-start gap-6 lg:grid-cols-2', activeTab !== 'compte-securite' && 'hidden')}
          >
            <AccountPasswordCard />
            <SecurityCodeCard userProfile={userProfile} />
          </section>

          <section
            id="settings-panel-application"
            role="tabpanel"
            aria-labelledby="settings-tab-application"
            tabIndex={0}
            className={cn('min-w-0', activeTab !== 'application' && 'hidden')}
          >
            <Card className="mb-6 grid min-w-0 gap-4 p-5 sm:grid-cols-2 sm:items-end">
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-ds-text">Apparence</h2>
                <p className="mt-1 text-sm text-ds-muted">Choisissez le thème clair, sombre ou celui de votre appareil.</p>
              </div>
              <Select
                label="Thème de l’application"
                value={theme}
                onChange={(event) => setTheme(event.target.value as ThemePreference)}
              >
                <option value="light">Clair</option>
                <option value="dark">Sombre</option>
                <option value="system">Système</option>
              </Select>
            </Card>
            <InstallAppCard deferredPrompt={deferredPrompt} handleInstallApp={handleInstallApp} isIOS={isIOS} isStandalone={isStandalone} />
          </section>

          {/* Card 1: Informations Générales de la Boutique */}
          {canAccessStoreSettings && (
          <section
            id="settings-panel-boutique"
            role="tabpanel"
            aria-labelledby="settings-tab-boutique"
            tabIndex={0}
            className={cn('min-w-0', activeTab !== 'boutique' && 'hidden')}
          >
          <Card className="min-w-0 overflow-hidden p-0">
            <div className="flex items-center gap-3 border-b border-ds-border bg-ds-surface-2 p-6">
              <div className="rounded-ds-md bg-ds-brand-soft p-2 text-ds-brand">
                <Store className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-ds-text">Informations Générales</h2>
                <p className="text-xs font-bold uppercase tracking-wider text-ds-muted">Coordonnées de l'activité imprimées sur les reçus</p>
              </div>
            </div>

            <div className="p-6">
              <form onSubmit={handleStoreSubmit} className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input
                      label="Nom du Boutique / Magasin"
                      type="text"
                      required
                      value={storeFormData.storeName}
                      onChange={(e) => setStoreFormData({ ...storeFormData, storeName: e.target.value })}
                      placeholder="Nom de la boutique"
                    />

                  <Input
                      label="Slogan de la boutique"
                      type="text"
                      value={storeFormData.storeTagline}
                      onChange={(e) => setStoreFormData({ ...storeFormData, storeTagline: e.target.value })}
                      placeholder="Slogan facultatif"
                    />

                  <Input
                      label="URL du logo"
                      type="url"
                      value={storeFormData.logo}
                      onChange={(e) => setStoreFormData({ ...storeFormData, logo: e.target.value })}
                      placeholder="https://…"
                    />

                  <Input
                      label="Devise du Magasin"
                      type="text"
                      required
                      value={storeFormData.currency}
                      onChange={(e) => setStoreFormData({ ...storeFormData, currency: e.target.value })}
                      placeholder="Ex: DT"
                    />

                  <Input
                      label="Adresse"
                      type="text"
                      value={storeFormData.address}
                      onChange={(e) => setStoreFormData({ ...storeFormData, address: e.target.value })}
                      placeholder="Ex: Avenue Habib Bourguiba, Tunis"
                    />

                  <Input
                      label="Téléphone du Magasin"
                      type="text"
                      value={storeFormData.phone}
                      onChange={(e) => setStoreFormData({ ...storeFormData, phone: e.target.value })}
                      placeholder="Ex: 71 000 000 ou 22 123 456"
                    />
                  {userProfile?.role === 'admin' && (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-ds-muted">+</span>
                        <Input
                          label="Indicatif téléphonique par défaut"
                          type="text"
                          inputMode="numeric"
                          required
                          value={storeFormData.whatsappCountryCode}
                          onChange={(e) => setStoreFormData({ ...storeFormData, whatsappCountryCode: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                          placeholder="216"
                        />
                      </div>
                      <p className="text-sm text-ds-muted">Par défaut : Tunisie (+216). Un numéro déjà international est conservé.</p>
                    </div>
                  )}
                </div>

                {userProfile?.role === 'admin' && (
                  <section className="space-y-3 rounded-ds-lg border border-ds-border bg-ds-surface-2 p-4">
                    <div>
                      <h3 className="text-sm font-black uppercase tracking-wider text-ds-text">Modèles WhatsApp / SMS</h3>
                      <p className="mt-1 text-sm text-ds-muted">Variables disponibles : {'{client}'}, {'{appareil}'}, {'{numero}'}, {'{montant_restant}'}, {'{nom_magasin}'}.</p>
                    </div>
                    {MESSAGE_TEMPLATE_OPTIONS.map(({ key, label }) => (
                      <label key={key} className="block space-y-1 text-sm font-bold text-ds-text">
                        {label}
                        <textarea
                          value={storeFormData.messageTemplates[key]}
                          onChange={(e) => setStoreFormData({
                            ...storeFormData,
                            messageTemplates: { ...storeFormData.messageTemplates, [key]: e.target.value },
                          })}
                          rows={3}
                          maxLength={1000}
                          className="w-full min-w-0 rounded-ds-md border border-ds-border bg-ds-surface px-3 py-2 text-base font-medium text-ds-text"
                        />
                      </label>
                    ))}
                  </section>
                )}

                <label className="flex min-h-ds-touch-target items-center justify-between gap-3 rounded-ds-lg border border-ds-border bg-ds-surface-2 p-4 my-2">
                  <div>
                    <span className="block text-sm font-bold text-ds-text">Facturation de la TVA</span>
                    <span className="mt-0.5 block text-sm font-medium leading-tight text-ds-muted">Calculer et appliquer la taxe sur la valeur ajoutée sur les ventes</span>
                  </div>
                  <input 
                    type="checkbox"
                    checked={storeFormData.tvaEnabled}
                    onChange={(e) => setStoreFormData({ ...storeFormData, tvaEnabled: e.target.checked })}
                    className="h-5 w-5 shrink-0 rounded border-ds-border accent-ds-brand"
                  />
                </label>

                <label className="block space-y-1.5 text-sm font-bold text-ds-text">
                  {t('sellerMention')}
                  <Select
                    value={storeFormData.sellerMentionMode}
                    onChange={event => setStoreFormData({
                      ...storeFormData,
                      sellerMentionMode: event.target.value as NonNullable<StoreSettings['sellerMentionMode']>,
                    })}
                    className="text-base sm:text-sm"
                  >
                    <option value="none">{t('sellerNone')}</option>
                    <option value="initial">{t('sellerInitial')}</option>
                    <option value="shortName">{t('sellerShortName')}</option>
                  </Select>
                </label>

                <Input
                    label="Taux de TVA (%)"
                    type="number" 
                    disabled={!storeFormData.tvaEnabled}
                    value={storeFormData.tva}
                    onChange={(e) => setStoreFormData({ ...storeFormData, tva: Number(e.target.value) })}
                  />

                {/* Seuil d'alerte de stock minimum par défaut */}
                <div className="space-y-2 rounded-ds-lg border border-ds-warning/20 bg-ds-warning-soft p-4 my-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-ds-warning" />
                    <div>
                      <label className="block text-sm font-bold text-ds-text">
                        Seuil d'Alerte de Stock Minimum Global
                      </label>
                      <span className="mt-0.5 block text-sm font-medium leading-tight text-ds-muted">
                        Déclenche une notification et une bannière visuelle dans le tableau de bord lorsqu'un produit atteint ou passe sous ce seuil.
                      </span>
                    </div>
                  </div>
                  <div className="flex min-w-0 items-center gap-3 pt-1">
                    <Input
                      aria-label="Seuil d'alerte de stock minimum"
                      type="number"
                      min="0"
                      max="1000"
                      value={storeFormData.minStockAlert}
                      onChange={(e) => setStoreFormData({ ...storeFormData, minStockAlert: Math.max(0, parseInt(e.target.value) || 0) })}
                      className="max-w-28 font-mono font-black"
                      placeholder="Ex: 5"
                    />
                    <span className="text-sm font-bold text-ds-muted">unités en stock</span>
                  </div>
                </div>

                <div className="pt-2">
                  <Button
                    type="submit"
                    className="w-full"
                  >
                    <Save className="w-4 h-4" />
                    Enregistrer les modifications
                  </Button>
                </div>
              </form>
            </div>
          </Card>

          </section>
          )}

          {/* Card 2: Configuration & Maintenance de la Base de Données */}
          {isAdmin && (
          <section
            id="settings-panel-donnees"
            role="tabpanel"
            aria-labelledby="settings-tab-donnees"
            tabIndex={0}
            className={cn('min-w-0', activeTab !== 'donnees' && 'hidden')}
          >
          <Card className="min-w-0 space-y-6">
            <div className="flex items-center gap-3 border-b border-ds-border pb-4">
              <div className="rounded-ds-md bg-ds-info/10 p-2 text-ds-info">
                <Database className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-ds-text">Base de données & Maintenance</h2>
                <p className="text-xs font-bold uppercase tracking-wider text-ds-muted">Outils d'archivage et d'allègement du magasin</p>
              </div>
            </div>

            {/* Rubrique 1: Sauvegarde Excel */}
            <div className="space-y-3">
              <div className="space-y-1">
                <h3 className="text-sm font-black uppercase tracking-wider text-ds-text">1. Sauvegarde Complète (Excel)</h3>
                <p className="text-sm font-medium leading-relaxed text-ds-muted">
                  Générez un fichier Excel multi-feuille contenant l'intégralité de la base de données (produits en stock, liste complète des clients, historique des ventes et factures).
                </p>
              </div>
              <Button
                type="button"
                onClick={handleExportExcel}
                disabled={isExporting}
                variant="secondary"
                className="w-full"
              >
                <Download className="h-4 w-4" />
                {isExporting ? 'Exportation en cours...' : 'Exporter toute la base de données (.xlsx)'}
              </Button>
            </div>

            <hr className="border-ds-border" />

            {/* Rubrique 2: Nettoyage et Allègement de l'historique */}
            <div className="space-y-4">
              <div className="space-y-1">
                <h3 className="text-sm font-black uppercase tracking-wider text-ds-text">2. Nettoyage de l'historique</h3>
                <p className="text-sm font-medium leading-relaxed text-ds-muted">
                  Allégez la base de données en supprimant définitivement les rapports de transactions (ventes et factures) antérieurs à une date limite de votre choix.
                </p>
              </div>

              {/* Date limite */}
              <div className="space-y-1.5">
                <label className="block text-sm font-bold text-ds-text">Transactions antérieures ou égales au :</label>
                <div className="relative">
                  <Calendar className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ds-muted" />
                  <Input
                    type="date"
                    value={purgeDate}
                    onChange={(e) => setPurgeDate(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>

              {/* Toggles */}
              <div className="grid grid-cols-1 gap-3 pt-1 sm:grid-cols-2">
                <label className="flex min-h-ds-touch-target items-center gap-2 rounded-ds-md border border-ds-border bg-ds-surface-2 p-3">
                  <input 
                    type="checkbox" 
                    checked={purgeSales}
                    onChange={(e) => setPurgeSales(e.target.checked)}
                    className="h-5 w-5 rounded border-ds-border accent-ds-danger"
                  />
                  <span className="text-sm font-bold text-ds-text">Purger les Ventes</span>
                </label>
                <label className="flex min-h-ds-touch-target items-center gap-2 rounded-ds-md border border-ds-border bg-ds-surface-2 p-3">
                  <input 
                    type="checkbox" 
                    checked={purgeInvoices}
                    onChange={(e) => setPurgeInvoices(e.target.checked)}
                    className="h-5 w-5 rounded border-ds-border accent-ds-danger"
                  />
                  <span className="text-sm font-bold text-ds-text">Purger les Factures</span>
                </label>
              </div>

              {/* Warning Area */}
              {purgeDate && (
                <div className="flex items-start gap-2.5 rounded-ds-md border border-ds-danger/20 bg-ds-danger-soft p-3.5 text-sm leading-relaxed text-ds-danger animate-in fade-in duration-300">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                  <div>
                    <span className="block text-xs font-extrabold uppercase tracking-wide">Alerte : Suppression définitive !</span>
                    Toutes les transactions correspondantes datées d'avant le <span className="font-bold underline">{new Date(purgeDate).toLocaleDateString('fr-FR')}</span> incluse seront définitivement supprimées afin d'alléger la base de données de caisse.
                  </div>
                </div>
              )}

              {/* Action Button */}
              <Button
                type="button"
                onClick={handlePurgeDatabase}
                disabled={isPurging || !purgeDate || (!purgeSales && !purgeInvoices)}
                variant="danger"
                className="w-full"
              >
                <Trash2 className="w-4 h-4 font-bold" />
                {isPurging ? 'Purge et allègement en cours...' : 'Purger et alléger de la base'}
              </Button>
            </div>

            <hr className="border-ds-border" />

            {/* Rubrique 3: Journal d'activité */}
            <div className="space-y-4">
              <div className="space-y-1">
                <h3 className="text-sm font-black uppercase tracking-wider text-ds-text">{t('activity.title')}</h3>
                <p className="text-sm font-medium leading-relaxed text-ds-muted">
                  {t('activity.description')}
                </p>
              </div>

              <ActivityLog userProfile={userProfile} />

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="block text-sm font-bold text-ds-text">{t('activity.dateStart')}</label>
                  <div className="relative">
                    <Calendar className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ds-muted" />
                    <Input
                      type="date"
                      value={activityStartDate}
                      max={todayStr}
                      onChange={(e) => { setActivityStartDate(e.target.value); setActivityError(''); }}
                      className="pl-10"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="block text-sm font-bold text-ds-text">{t('activity.dateEnd')}</label>
                  <div className="relative">
                    <Calendar className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ds-muted" />
                    <Input
                      type="date"
                      value={activityEndDate}
                      max={todayStr}
                      onChange={(e) => { setActivityEndDate(e.target.value); setActivityError(''); }}
                      className="pl-10"
                    />
                  </div>
                </div>
              </div>

              {activityError && (
                <div role="alert" className="flex items-start gap-2.5 rounded-ds-md border border-ds-danger/20 bg-ds-danger-soft p-3.5 text-sm leading-relaxed text-ds-danger animate-in fade-in duration-300">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                  <span className="font-semibold">{activityError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Button
                  type="button"
                  onClick={handleViewActivityLog}
                  disabled={isLoadingActivityView || !activityStartDate || !activityEndDate}
                  variant="secondary"
                  className="w-full"
                >
                  <Eye className="w-4 h-4" />
                  {isLoadingActivityView ? t('activity.loading') : t('activity.show')}
                </Button>
                <Button
                  type="button"
                  onClick={handleDownloadActivityLog}
                  disabled={isGeneratingActivity || !activityStartDate || !activityEndDate}
                  variant="secondary"
                  className="w-full"
                >
                  <FileText className="w-4 h-4" />
                  {isGeneratingActivity ? t('activity.generating') : t('activity.download')}
                </Button>
              </div>
            </div>
          </Card>
          </section>
          )}

        </div>
      )}

      <section
          id="settings-panel-coran-adhkar"
          role="tabpanel"
          aria-labelledby="settings-tab-coran-adhkar"
          tabIndex={0}
          className={cn('min-w-0', activeTab !== 'coran-adhkar' && 'hidden')}
        >
        <StartupPreferencesPanel
          preferences={personalPreferences}
          onChange={updatePersonalPreferences}
        />
        {canManageStartup && <Card id="startup-settings" className="min-w-0 space-y-4">
          <div className="flex items-center gap-3">
            <div className="rounded-ds-md bg-ds-brand-soft p-2 text-ds-brand"><Music2 className="h-5 w-5" /></div>
            <div>
              <h2 className="text-sm font-bold text-ds-text">Coran &amp; Adhkar</h2>
              <p className="text-xs font-bold uppercase tracking-wider text-ds-muted">Écran d’accueil et récitation audio</p>
            </div>
            <label className="ml-auto flex min-h-ds-touch-target items-center gap-2 text-sm font-bold text-ds-text">
              <input
                type="checkbox"
                checked={startupEnabled}
                onChange={(event) => setStartupEnabled(event.target.checked)}
                className="h-5 w-5 rounded border-ds-border accent-ds-brand"
              />
              Activer
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Select
                label="Choisir une āya ou un adhkar"
                value={selectedWelcomeChoice}
                onChange={(event) => {
                  const choice = welcomeChoices.find((item) => item.id === event.target.value);
                  if (!choice) return;
                  setWelcomeTitle(choice.title);
                  setWelcomeText(choice.text);
                  setWelcomeSource(choice.source);
                }}
              >
                <option value="custom">Texte personnalisé</option>
                {welcomeChoices.map((choice) => (
                  <option key={choice.id} value={choice.id}>{choice.title}</option>
                ))}
              </Select>
            <Input
                label="Titre"
                value={welcomeTitle}
                onChange={(event) => setWelcomeTitle(event.target.value)}
                maxLength={200}
              />
          </div>

          <label className="block space-y-1 text-sm font-medium text-ds-text">
            Texte affiché
            <textarea
              value={welcomeText}
              onChange={(event) => setWelcomeText(event.target.value)}
              maxLength={5000}
              dir="rtl"
              lang="ar"
              rows={3}
              className="w-full min-w-0 rounded-ds-md border border-ds-border bg-ds-surface px-3 py-2.5 text-right text-base font-arabic font-medium text-ds-text"
            />
          </label>
          <label className="block space-y-1 text-sm font-medium text-ds-text">
            Source (facultative)
            <Input
              value={welcomeSource}
              onChange={(event) => setWelcomeSource(event.target.value)}
              maxLength={500}
            />
          </label>

          <label className="block space-y-1 text-sm font-medium text-ds-text">
            رابط URL للمقطع الصوتي (HTTPS direct : .mp3, .m4a, .ogg ou .wav)
            <Input
              type="url"
              value={startupAudioUrl}
              onChange={(event) => setStartupAudioUrl(event.target.value)}
              placeholder="https://…/recitation.mp3"
            />
          </label>
          <div className="space-y-2">
            <Button type="button" variant="secondary" onClick={testStartupAudio}>
              Tester la lecture
            </Button>
            <audio
              ref={startupAudioPreview}
              controls
              preload="none"
              src={isDirectAudioUrl(startupAudioUrl) ? startupAudioUrl.trim() : undefined}
              onError={() => setStartupAudioTestMessage('Fichier illisible ou inaccessible. Vérifiez le lien direct et les autorisations CORS de l’hébergeur.')}
              className="w-full"
            />
            {startupAudioTestMessage && <Badge variant="danger" role="status" className="min-h-0 rounded-ds-md">{startupAudioTestMessage}</Badge>}
          </div>
          <aside className="rounded-ds-md border border-ds-info/20 bg-ds-accent-soft p-3 text-sm text-ds-text">
            Hébergez gratuitement votre fichier audio avec le palier gratuit de Cloudflare R2 ou sur Internet Archive. Après l’envoi, copiez le lien public direct du fichier (et non la page de partage) ; l’hébergeur doit autoriser la lecture depuis le navigateur (CORS). Aucun fichier n’est téléversé dans Firebase.
          </aside>
          <p className="text-sm text-ds-muted">L’audio ne démarre qu’après le bouton « دخول » de l’écran d’accueil.</p>
          {startupMessage && <Badge variant="info" role="status" className="min-h-0 rounded-ds-md">{startupMessage}</Badge>}
          <Button
            type="button"
            onClick={() => void saveStartupSettings()}
            disabled={startupSaving}
          >
            <Save className="h-4 w-4" />
            {startupSaving ? 'Enregistrement…' : 'Enregistrer Coran & Adhkar'}
          </Button>
        </Card>
        }
      </section>

      {/* Modal Journal d'activité (affichage en ligne, style fichier log) */}
      {showActivityLogModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-ds-text/50 p-4 animate-in fade-in duration-200">
          <Card className="flex max-h-[85vh] w-full min-w-0 max-w-3xl flex-col overflow-hidden p-0">
            <div className="flex items-center justify-between border-b border-ds-border px-5 py-4">
              <div className="flex items-center gap-2.5">
                <div className="rounded-ds-md bg-ds-brand p-2 text-ds-brand-contrast">
                  <FileText className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-ds-text">{t('activity.modalTitle')}</h3>
                  <p className="text-xs font-bold uppercase tracking-wider text-ds-muted">
                    {t('activity.rangeSummary', { start: activityStartDate, end: activityEndDate, count: activityLogLines.length })}
                  </p>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowActivityLogModal(false)}
                aria-label={t('activity.close')}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            <div className="min-w-0 flex-1 overflow-y-auto bg-ds-surface-2 p-4">
              <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-relaxed text-ds-text">
                {activityLogLines.join('\n')}
              </pre>
            </div>

            <div className="flex justify-end border-t border-ds-border px-5 py-3.5">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setShowActivityLogModal(false)}
              >
                {t('activity.close')}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Success Toast */}
      {success && (
        <div className="fixed bottom-8 right-8 z-[100] animate-in fade-in slide-in-from-bottom-4 duration-300">
          <Badge variant="success" role="status" className="rounded-ds-md bg-ds-success p-4 text-ds-brand-contrast shadow-ds-md">
            <CheckCircle2 className="mr-2 h-5 w-5 shrink-0" />
            {success}
          </Badge>
        </div>
      )}
    </div>
  );
}

class SettingsErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error('Settings page rendering failed:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div role="alert" className="mx-auto max-w-4xl rounded-ds-lg border border-ds-danger/20 bg-ds-danger-soft p-6 text-ds-danger">
          <h1 className="text-lg font-bold">Paramètres indisponibles</h1>
          <p className="mt-2 text-sm">Une erreur est survenue pendant l’affichage de cette page. Actualisez-la ou réessayez plus tard.</p>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function Settings(props: SettingsProps) {
  return (
    <SettingsErrorBoundary>
      <SettingsContent {...props} />
    </SettingsErrorBoundary>
  );
}
