import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, query, doc, setDoc, updateDoc, deleteDoc, where, getDocs, getDoc, writeBatch } from 'firebase/firestore';
import { db, auth, firebaseConfig } from '../firebase';
import { initializeApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { UserProfile } from '../types';
import { 
  Users as UsersIcon, 
  Activity,
  UserPlus, 
  User,
  X, 
  Shield, 
  Ban, 
  CheckCircle2, 
  AlertCircle, 
  Mail, 
  Trash2,
  Lock,
  Sliders,
  Check,
  Eye,
  EyeOff,
  Copy,
  Edit2
} from 'lucide-react';
import { cn } from '../lib/utils';
import { mergePermissions, PERMISSION_FLAGS, PermissionMap, PermissionPreset, permissionPreset, permissionsForPreset } from '../lib/permissions';
import { useIsSuperAdmin } from '../lib/useIsSuperAdmin';
import { apiRequest, checkApiHealth } from '../lib/api';
import { slugifyAppName } from '../lib/brand';
import { useBrand } from './BrandProvider';
import { Badge, Button, Card, EmptyState, Input, PageHeader, Select } from './ui';
import { useTranslation } from 'react-i18next';

const MENU_OPTIONS = [
  'dashboard', 'reparation', 'pieces', 'pos', 'products', 'clients',
  'sales', 'invoices', 'notes', 'settings', 'users',
].map(id => ({ id }));

type UserFormRole = UserProfile['role'] | 'technician' | 'cashier-repair';

const isTechnicianProfile = (profile: UserProfile, menus = profile.allowedMenus || []) =>
  profile.role === 'user' && menus.includes('reparation') &&
  menus.includes('pieces') &&
  menus.every(menu => ['reparation', 'pieces', 'products', 'clients'].includes(menu));

const DEFAULT_USER_MENUS = ['dashboard', 'pos', 'products', 'clients', 'sales', 'invoices'];
const CASHIER_REPAIR_MENUS = [
  'pos', 'reparation', 'pieces', 'products', 'clients',
];
const TECHNICIAN_MENUS = ['reparation', 'pieces', 'products', 'clients'];

interface UsersProps {
  userProfile: UserProfile | null;
}

export default function Users({ userProfile }: UsersProps) {
  const { t } = useTranslation('users');
  const brand = useBrand();
  // Initialize with the current admin's own profile so they always appear at the top
  const [users, setUsers] = useState<UserProfile[]>(userProfile ? [userProfile] : []);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loading, setLoading] = useState(!userProfile);
  const [success, setSuccess] = useState<string | null>(null);
  const [errorOnCreate, setErrorOnCreate] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [passwordUser, setPasswordUser] = useState<UserProfile | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [deletingUser, setDeletingUser] = useState<UserProfile | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [migrationConfirmOpen, setMigrationConfirmOpen] = useState(false);
  const [apiHealth, setApiHealth] = useState<{ ok: boolean; message: string } | null>(null);
  const [apiHealthLoading, setApiHealthLoading] = useState(false);

  const ownerId = userProfile?.ownerId || userProfile?.uid || 'no_user_auth';

  const [copiedField, setCopiedField] = useState<string | null>(null);
  const isSuperAdmin = useIsSuperAdmin();

  // Form states - Create
  const [nameInput, setNameInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [roleInput, setRoleInput] = useState<UserFormRole>('cashier-repair');
  const [selectedMenus, setSelectedMenus] = useState<string[]>(CASHIER_REPAIR_MENUS);
  const [permissionsInput, setPermissionsInput] = useState<PermissionMap>(permissionsForPreset('cashier'));
  const [permissionMigrationPreview, setPermissionMigrationPreview] = useState<UserProfile[]>([]);
  const [permissionMigrationBackupDownloaded, setPermissionMigrationBackupDownloaded] = useState(false);
  const [permissionMigrationBusy, setPermissionMigrationBusy] = useState(false);
  const [permissionMigrationError, setPermissionMigrationError] = useState<string | null>(null);

  // Unified editing state
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editRole, setEditRole] = useState<UserFormRole>('user');
  const [editStatus, setEditStatus] = useState<'active' | 'banned'>('active');
  const [editSelectedMenus, setEditSelectedMenus] = useState<string[]>([]);
  const [editPermissions, setEditPermissions] = useState<PermissionMap>(permissionsForPreset('cashier'));
  const [editSecurityCode, setEditSecurityCode] = useState('');
  const [errorOnEdit, setErrorOnEdit] = useState<string | null>(null);

  // Visibilité du code individuel de chaque utilisateur dans le tableau
  const [visibleCodes, setVisibleCodes] = useState<Record<string, boolean>>({});
  const toggleCodeVisibility = (uid: string) => setVisibleCodes((prev) => ({ ...prev, [uid]: !prev[uid] }));

  const renderPermissionOptions = (
    menus: string[],
    permissions: PermissionMap,
    setPermissions: (next: PermissionMap) => void,
  ) => (
    <div className="ms-3 space-y-3 border-s-2 border-ds-border ps-3">
      {(['pieces', 'products', 'reparation', 'clients'] as const)
        .filter(menuId => menus.includes(menuId))
        .map(menuId => (
          <div key={menuId} className="space-y-1">
          <p className="text-xs font-black uppercase tracking-wider text-ds-muted">
              {t(`menus.${menuId}.name`)}
            </p>
            {PERMISSION_FLAGS[menuId].map(({ id, label }) => (
              <label key={id} className="flex min-h-ds-touch-target items-center gap-2 text-sm font-medium text-ds-text">
                <input
                  type="checkbox"
                  checked={permissions[menuId]?.[id] === true}
                  onChange={event => setPermissions({
                    ...permissions,
                    [menuId]: { ...permissions[menuId], [id]: event.target.checked },
                  })}
                  className="h-4 w-4 rounded border-ds-border accent-ds-brand"
                />
                {label}
              </label>
            ))}
          </div>
        ))}
      <div className="space-y-1 border-t border-ds-border pt-2">
        <p className="text-xs font-black uppercase tracking-wider text-ds-muted">{t('menus.startup.name')}</p>
        {PERMISSION_FLAGS.startup.map(({ id, label }) => (
          <label key={id} className="flex min-h-ds-touch-target items-center gap-2 text-sm font-medium text-ds-text">
            <input
              type="checkbox"
              checked={permissions.startup?.[id] === true}
              onChange={event => setPermissions({
                ...permissions,
                startup: { ...permissions.startup, [id]: event.target.checked },
              })}
              className="h-4 w-4 rounded border-ds-border accent-ds-brand"
            />
            {label}
          </label>
        ))}
      </div>
    </div>
  );

  const presetFromRole = (role: UserFormRole): PermissionPreset =>
    role === 'admin' ? 'admin' : role === 'technician' ? 'technician' : 'cashier';

  const previewPermissionMigration = () => {
    const missing = users.filter(profile => !profile.permissions);
    setPermissionMigrationPreview(missing);
    setPermissionMigrationBackupDownloaded(false);
    setPermissionMigrationError(null);
    setSuccess(`${missing.length} compte(s) à migrer. Aucun document n’a été modifié.`);
  };

  const downloadPermissionMigrationBackup = () => {
    if (permissionMigrationPreview.length === 0) return;
    const backup = permissionMigrationPreview.map(profile => ({
      uid: profile.uid,
      email: profile.email,
      role: profile.role,
      allowedMenus: profile.allowedMenus || null,
      permissions: profile.permissions || null,
    }));
    const blob = new Blob([JSON.stringify({ createdAt: new Date().toISOString(), users: backup }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${slugifyAppName(brand.storeName)}-permissions-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setPermissionMigrationBackupDownloaded(true);
  };

  const confirmPermissionMigration = async () => {
    if (!permissionMigrationBackupDownloaded || permissionMigrationPreview.length === 0 ||
      permissionMigrationBusy) return;
    setMigrationConfirmOpen(false);
    setPermissionMigrationBusy(true);
    setPermissionMigrationError(null);
    try {
      for (let offset = 0; offset < permissionMigrationPreview.length; offset += 400) {
        const batch = writeBatch(db);
        permissionMigrationPreview.slice(offset, offset + 400).forEach(profile => {
          if (!profile.permissions) {
            batch.update(doc(db, 'users', profile.uid), {
              permissions: permissionsForPreset(permissionPreset(profile)),
            });
          }
        });
        await batch.commit();
      }
      setPermissionMigrationPreview([]);
      setPermissionMigrationBackupDownloaded(false);
      setSuccess('Migration des permissions terminée.');
    } catch (issue) {
      setPermissionMigrationError(issue instanceof Error ? issue.message : String(issue));
    } finally {
      setPermissionMigrationBusy(false);
    }
  };

  useEffect(() => {
    if (!auth.currentUser || !userProfile) return;

    setLoading(true);

    // Un magasin ne doit voir que ses propres comptes (lui-même + ses collaborateurs).
    // Seul le super-admin de la plateforme voit tous les magasins,
    // ce qui est nécessaire pour l'administration multi-magasins et les migrations.
    const myOwnerId = userProfile.ownerId || userProfile.uid;

    const filterToOwnStore = (allDocs: UserProfile[]) => {
      if (isSuperAdmin) {
        return allDocs.filter(u => u.uid !== userProfile.uid);
      }
      return allDocs.filter(u => u.uid !== userProfile.uid && (u.ownerId || u.uid) === myOwnerId);
    };

    // Utiliser getDocs pour une lecture immédiate de TOUS les users (super-admin)
    // ou uniquement des comptes de son propre magasin (admin standard)
    // puis onSnapshot pour les mises à jour en temps réel
    const qAll = isSuperAdmin
      ? query(collection(db, 'users'))
      : query(collection(db, 'users'), where('ownerId', '==', myOwnerId));

    // Lecture initiale immédiate
    getDocs(qAll).then((snapshot) => {
      const allDocs = snapshot.docs.map(d => ({ ...d.data(), uid: d.id } as UserProfile));
      const subUsers = filterToOwnStore(allDocs);
      setUsers([userProfile, ...subUsers]);
      setLoading(false);
    }).catch(err => {
      console.error('Unable to load user profiles.', { code: err?.code, message: err?.message });
      setLoading(false);
    });

    // Écoute en temps réel pour les ajouts/modifs après chargement
    const unsub = onSnapshot(qAll, (snapshot) => {
      const allDocs = snapshot.docs.map(d => ({ ...d.data(), uid: d.id } as UserProfile));
      const subUsers = filterToOwnStore(allDocs);
      setUsers([userProfile, ...subUsers]);
    }, (err) => {
      console.error('Unable to refresh user profiles.', { code: err?.code, message: err?.message });
    });

    return () => unsub();
  }, [userProfile?.uid, isSuperAdmin]);

  const handleRoleChangeOnCreate = (role: UserFormRole) => {
    setRoleInput(role);
    setPermissionsInput(permissionsForPreset(presetFromRole(role)));
    if (role === 'admin') {
      setSelectedMenus(MENU_OPTIONS.map(m => m.id));
    } else if (role === 'technician') {
      setSelectedMenus(TECHNICIAN_MENUS);
    } else if (role === 'cashier-repair') {
      setSelectedMenus(CASHIER_REPAIR_MENUS);
    } else {
      setSelectedMenus(DEFAULT_USER_MENUS);
    }
  };

  const handleToggleMenuSelection = (menuId: string) => {
    setSelectedMenus(prev => 
      prev.includes(menuId) ? prev.filter(id => id !== menuId) : [...prev, menuId]
    );
  };

  const handleToggleEditMenuSelection = (menuId: string) => {
    setEditSelectedMenus(prev => 
      prev.includes(menuId) ? prev.filter(id => id !== menuId) : [...prev, menuId]
    );
  };

  const copyToClipboard = async (text: string, fieldKey: string) => {
    try {
    await navigator.clipboard.writeText(text);
    setCopiedField(fieldKey);
    setTimeout(() => setCopiedField(null), 2000);
    } catch (error) {
    console.error('Unable to copy user information.');
    setErrorOnEdit(error instanceof Error ? error.message : 'Copie impossible.');
    }
  };

  const sendPasswordResetLink = async (email: string) => {
    try {
      await sendPasswordResetEmail(auth, email);
      setSuccess(`Lien de réinitialisation envoyé à ${email}.`);
      setErrorOnCreate(null);
      setTimeout(() => setSuccess(null), 5000);
    } catch (issue) {
      setErrorOnCreate(issue instanceof Error ? `Impossible d’envoyer le lien : ${issue.message}` : 'Impossible d’envoyer le lien.');
    }
  };

  const handleChangeUserPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!passwordUser) return;
    if (newPassword.length < 8) {
      setErrorOnCreate('Le mot de passe doit contenir au moins 8 caractères.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setErrorOnCreate('La confirmation ne correspond pas au nouveau mot de passe.');
      return;
    }
    setErrorOnCreate(null);
    setActionLoading(passwordUser.uid);
    try {
      await apiRequest('/admin/users/update', {
        method: 'POST',
        body: JSON.stringify({ uid: passwordUser.uid, password: newPassword }),
      });
      setPasswordUser(null);
      setNewPassword('');
      setConfirmNewPassword('');
      setSuccess(`Mot de passe modifié pour ${passwordUser.email}.`);
      setTimeout(() => setSuccess(null), 4000);
    } catch (issue) {
      setErrorOnCreate(issue instanceof Error ? issue.message : 'Impossible de modifier le mot de passe.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorOnCreate(null);
    setActionLoading('creating');

    // 1. Validation rigoureuse des données d'entrée
    if (!nameInput || nameInput.trim().length < 2) {
      setErrorOnCreate("Le nom de l'utilisateur est obligatoire (min 2 caractères).");
      setActionLoading(null);
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const cleanEmail = emailInput.trim().toLowerCase();
    if (!cleanEmail || !emailRegex.test(cleanEmail)) {
      setErrorOnCreate("Veuillez saisir une adresse email valide.");
      setActionLoading(null);
      return;
    }

    if (!passwordInput || passwordInput.length < 6) {
      setErrorOnCreate("Le mot de passe obligatoire doit contenir au moins 6 caractères.");
      setActionLoading(null);
      return;
    }

    if (selectedMenus.length === 0) {
      setErrorOnCreate("Veuillez sélectionner au moins un privilège d'accès.");
      setActionLoading(null);
      return;
    }

    // 2. Vérification d'existence de l'utilisateur dans Firestore pour éviter les doublons
    try {
      const usersRef = collection(db, 'users');
      const q = query(usersRef, where('ownerId', '==', ownerId));
      const querySnapshot = await getDocs(q);
      const emailExists = querySnapshot.docs.some((userDoc) =>
        userDoc.data().email === cleanEmail
      );

      if (emailExists) {
        setErrorOnCreate("Cette adresse email est déjà en cours d'utilisation.");
        setActionLoading(null);
        return;
      }
    } catch (fsErr: any) {
      console.error('Unable to verify whether the user profile already exists.', {
        code: fsErr?.code,
        message: fsErr?.message,
      });
      setErrorOnCreate('Erreur de connexion lors de la vérification de l’utilisateur.');
      setActionLoading(null);
      return;
    }

    const tempAppName = 'TempUserCreation_' + Date.now();
    let tempApp: any = null;
    let targetUid = '';

    // 3. Tenter l'ajout de l'utilisateur dans Firebase Auth via l'application temporaire
    try {
      tempApp = initializeApp(firebaseConfig, tempAppName);
      const tempAuth = getAuth(tempApp);

      const userCred = await createUserWithEmailAndPassword(tempAuth, cleanEmail, passwordInput);
      targetUid = userCred.user.uid;
      await tempAuth.signOut();
    } catch (authErr: any) {
      console.error('Unable to create the authentication account.');
      let errorMsg = "La création du compte d'authentification a échoué.";
      if (authErr.code === 'auth/email-already-in-use') {
        errorMsg = "Cette adresse email est déjà utilisée dans Firebase Authentication.";
      } else if (authErr.code === 'auth/weak-password') {
        errorMsg = "Le mot de passe choisi doit contenir au moins 6 caractères.";
      } else if (authErr.code === 'auth/invalid-email') {
        errorMsg = "L'adresse email saisie est invalide pour Firebase Authentication.";
      } else if (authErr.message) {
        errorMsg += ` Détails : ${authErr.message}`;
      }
      setErrorOnCreate(errorMsg);
      setActionLoading(null);
      if (tempApp) {
        try {
          await tempApp.delete();
        } catch (delErr) {
          console.error('Unable to dispose of the temporary authentication app.');
        }
      }
      return;
    }

    // 4. Création de la fiche d'utilisateur dans Firestore
    try {
      await setDoc(doc(db, "users", targetUid), {
        uid: targetUid,
        name: nameInput.trim(),
        email: cleanEmail,
        role: roleInput === 'admin' ? 'admin' : 'user',
        status: 'active',
        allowedMenus: selectedMenus,
        permissions: roleInput === 'admin' ? permissionsForPreset('admin') : permissionsInput,
        ownerId: roleInput === 'admin' ? targetUid : ownerId,
        creatorId: ownerId,
        createdAt: new Date().toISOString()
      });
      try {
        await sendPasswordResetEmail(auth, cleanEmail);
        setSuccess('Utilisateur créé. Son lien de définition du mot de passe a été envoyé.');
      } catch (resetError) {
        console.error('The user was created but the password reset email could not be sent.');
        setSuccess('Utilisateur créé, mais le lien de réinitialisation n’a pas pu être envoyé. Renvoyez-le depuis sa ligne.');
      }

      setIsModalOpen(false);
      setNameInput('');
      setEmailInput('');
      setPasswordInput('');
      setRoleInput('cashier-repair');
      setSelectedMenus(CASHIER_REPAIR_MENUS);
      setPermissionsInput(permissionsForPreset('cashier'));

      setTimeout(() => setSuccess(null), 4000);
    } catch (err: any) {
      console.error("Unable to save the user's Firestore profile.");
      setErrorOnCreate(`Impossible d'enregistrer l'utilisateur en base: ${err.message || 'Permission refusée'}`);
    } finally {
      if (tempApp) {
        try {
          await tempApp.delete();
        } catch (delErr) {
          console.error('Unable to dispose of the temporary authentication app.');
        }
      }
      setActionLoading(null);
    }
  };

  // Collections contenant un champ ownerId à réaligner lors d'une migration de compte admin
  const OWNER_ID_COLLECTIONS = ['products', 'sales', 'invoices', 'clients', 'categories', 'supplies', 'notes'];

  const cascadeOwnerIdMigration = async (oldOwnerId: string, newOwnerId: string) => {
    for (const collectionName of OWNER_ID_COLLECTIONS) {
      try {
        const q = query(collection(db, collectionName), where('ownerId', '==', oldOwnerId));
        const snap = await getDocs(q);
        if (snap.empty) continue;

        // Firestore limite un batch à 500 opérations, on découpe par sécurité
        for (let i = 0; i < snap.docs.length; i += 450) {
          const chunk = snap.docs.slice(i, i + 450);
          const batch = writeBatch(db);
          chunk.forEach((d) => batch.update(d.ref, { ownerId: newOwnerId }));
          await batch.commit();
        }
      } catch (err) {
        console.error('Unable to migrate a collection owner reference.');
      }
    }

    // Le document settings/{ownerId} et counters/invoices_{ownerId} utilisent l'ownerId comme identifiant de document
    try {
      const oldSettingsSnap = await getDoc(doc(db, 'settings', oldOwnerId));
      if (oldSettingsSnap.exists()) {
        await setDoc(doc(db, 'settings', newOwnerId), oldSettingsSnap.data());
        await deleteDoc(doc(db, 'settings', oldOwnerId));
      }
    } catch (err) {
      console.error('Unable to migrate store settings.');
    }

    try {
      const oldCounterId = `invoices_${oldOwnerId}`;
      const oldCounterSnap = await getDoc(doc(db, 'counters', oldCounterId));
      if (oldCounterSnap.exists()) {
        await setDoc(doc(db, 'counters', `invoices_${newOwnerId}`), oldCounterSnap.data());
        await deleteDoc(doc(db, 'counters', oldCounterId));
      }
    } catch (err) {
      console.error('Unable to migrate invoice counters.');
    }
  };

  const handleOpenEdit = (user: UserProfile) => {
    setEditingUser(user);
    setEditName(user.name || '');
    setEditEmail(user.email || '');
    const existingMenus = user.allowedMenus || (
      user.role === 'admin'
        ? MENU_OPTIONS.map(m => m.id)
        : ['dashboard', 'pos', 'products', 'clients', 'sales', 'invoices', 'notes']
    );
    setEditRole(isTechnicianProfile(user, existingMenus)
      ? 'technician'
      : user.role === 'user' && CASHIER_REPAIR_MENUS.every(menu => existingMenus.includes(menu))
        ? 'cashier-repair'
        : user.role || 'user');
    setEditStatus(user.status || 'active');
    setEditSelectedMenus(existingMenus);
    setEditPermissions(mergePermissions(permissionPreset(user), user.permissions));
    setEditSecurityCode(user.securityCode || '');
    setErrorOnEdit(null);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setErrorOnEdit(null);
    setActionLoading('editing');

    if (!editName || editName.trim().length < 2) {
      setErrorOnEdit("Le nom est obligatoire (min 2 caractères).");
      setActionLoading(null);
      return;
    }

    const cleanEmail = editEmail.trim().toLowerCase();
    if (cleanEmail !== editingUser.email) {
      setErrorOnEdit('L’adresse de connexion ne peut pas être modifiée depuis ce formulaire. Envoyez un lien de réinitialisation à l’utilisateur.');
      setActionLoading(null);
      return;
    }

    if (editSelectedMenus.length === 0) {
      setErrorOnEdit('Veuillez sélectionner au moins un droit d\'accès.');
      setActionLoading(null);
      return;
    }

    if (editSecurityCode && !/^[0-9]{4}$/.test(editSecurityCode)) {
      setErrorOnEdit('Le code de sécurité doit contenir exactement 4 chiffres (ou être laissé vide).');
      setActionLoading(null);
      return;
    }

    try {
      await updateDoc(doc(db, 'users', editingUser.uid), {
        name: editName.trim(),
        role: editRole === 'admin' ? 'admin' : 'user',
        status: editStatus,
        allowedMenus: editSelectedMenus,
        permissions: editRole === 'admin' ? permissionsForPreset('admin') : editPermissions,
        securityCode: editSecurityCode || '',
        ownerId: editRole === 'admin' ? editingUser.uid : ownerId,
      });
      setSuccess(`Utilisateur ${cleanEmail} mis à jour avec succès.`);
      setEditingUser(null);
      setTimeout(() => setSuccess(null), 6000);
    } catch (err: any) {
      console.error('Unable to update the user profile.');
      setErrorOnEdit(err.message || 'Une erreur est survenue lors de la modification.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleToggleStatus = async (user: UserProfile) => {
    const newStatus = user.status === 'banned' ? 'active' : 'banned';
    setActionLoading(user.uid);
    setErrorOnCreate(null);
    try {
      // Directly check and update in Firestore using active session
      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, {
        status: newStatus
      });

      setSuccess(`L'utilisateur ${user.email} est désormais ${newStatus === 'banned' ? 'banni' : 'actif'}.`);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setErrorOnCreate(err instanceof Error ? err.message : 'Erreur de mise à jour.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteProfileAndAuth = async (user: UserProfile) => {
    if (user.uid === userProfile?.uid) {
      setErrorOnCreate('Vous ne pouvez pas supprimer votre propre compte administrateur.');
      return;
    }
    const storeOwnerId = userProfile?.ownerId || userProfile?.uid;
    const storeAdmins = users.filter(profile =>
      profile.role === 'admin' && (profile.ownerId || profile.uid) === storeOwnerId
    );
    if (user.role === 'admin' && storeAdmins.length <= 1) {
      setErrorOnCreate('Impossible de supprimer le dernier administrateur du magasin.');
      return;
    }
    if (deleteConfirmation.trim().toLowerCase() !== user.email.toLowerCase()) {
      return;
    }

    setActionLoading(user.uid);
    setErrorOnCreate(null);
    try {
      await apiRequest('/admin/users/delete', {
        method: 'POST',
        body: JSON.stringify({ uid: user.uid }),
      });
      setUsers((current) => current.filter((profile) => profile.uid !== user.uid));
      setDeletingUser(null);
      setDeleteConfirmation('');
      setSuccess(`Utilisateur ${user.email} supprimé.`);
      setTimeout(() => setSuccess(null), 4000);
    } catch (error) {
      console.error('Unable to delete user profile.');
      setErrorOnCreate(error instanceof Error ? error.message : 'Impossible de supprimer cet utilisateur.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleApiHealthCheck = async () => {
    setApiHealthLoading(true);
    setApiHealth(null);
    try {
      await checkApiHealth();
      setApiHealth({ ok: true, message: 'Serveur API accessible.' });
    } catch (error) {
      setApiHealth({
        ok: false,
        message: error instanceof Error ? error.message : 'Vérification du serveur impossible.',
      });
    } finally {
      setApiHealthLoading(false);
    }
  };

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl space-y-6">
      <PageHeader
        title={t('page.title')}
        description={t('page.description')}
        actions={<div className="flex min-w-0 flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            type="button"
            onClick={() => void handleApiHealthCheck()}
            disabled={apiHealthLoading}
          >
            <Activity className="h-4 w-4" />
            {apiHealthLoading ? t('checking') : t('testServer')}
          </Button>
          <Button
            onClick={() => {
              setErrorOnCreate(null);
              setRoleInput('cashier-repair');
              setSelectedMenus(CASHIER_REPAIR_MENUS);
              setPermissionsInput(permissionsForPreset('cashier'));
              setIsModalOpen(true);
            }}
          >
            <UserPlus className="w-4 h-4" />
            {t('createUser')}
          </Button>
        </div>}
      />
      {apiHealth && (
        <Badge role={apiHealth.ok ? 'status' : 'alert'} variant={apiHealth.ok ? 'success' : 'danger'}>{apiHealth.message}</Badge>
      )}

      <Card className="min-w-0 space-y-3">
        <Button
          variant="secondary"
          type="button"
          onClick={previewPermissionMigration}
          disabled={permissionMigrationBusy}
        >
          {t('permissionMigration.preview')}
        </Button>
        {permissionMigrationError && <p role="alert" className="text-sm font-semibold text-ds-danger">{permissionMigrationError}</p>}
        {permissionMigrationPreview.length > 0 && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-bold text-ds-text">{t('permissionMigration.accountsWithoutPermissions', { count: permissionMigrationPreview.length })}</p>
              <div className="flex gap-2">
                <Button type="button" variant="secondary" onClick={downloadPermissionMigrationBackup}>{t('permissionMigration.downloadBackup')}</Button>
                <Button type="button" variant="primary" onClick={() => setMigrationConfirmOpen(true)} disabled={!permissionMigrationBackupDownloaded || permissionMigrationBusy}>{permissionMigrationBusy ? t('permissionMigration.running') : t('permissionMigration.confirm')}</Button>
              </div>
            </div>
            <ul className="max-h-36 space-y-1 overflow-y-auto text-sm text-ds-muted">
              {permissionMigrationPreview.map(profile => <li key={profile.uid} className="rounded-ds-md bg-ds-surface-2 px-3 py-2">{profile.name || profile.email} · {permissionPreset(profile)}</li>)}
            </ul>
          </>
        )}
      </Card>

      {success && (
        <Badge variant="success" role="status" className="min-h-0 rounded-ds-md p-4 text-sm">
          <CheckCircle2 className="me-2 h-4 w-4 shrink-0" />
          {success}
        </Badge>
      )}
      {errorOnCreate && !isModalOpen && (
        <div role="alert" className="rounded-ds-md border border-ds-danger/20 bg-ds-danger-soft p-4 text-sm font-bold text-ds-danger">
          {errorOnCreate}
        </div>
      )}

      {/* Main Table with User Details/Credentials */}
      <Card className="min-w-0 overflow-hidden p-0">
        {loading ? (
          <div className="flex items-center justify-center p-16">
            <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-ds-brand" />
          </div>
        ) : users.length === 0 ? (
          <EmptyState icon={<UsersIcon className="h-12 w-12" />} title={t('table.empty')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="responsive-card-table w-full text-start border-collapse">
              <thead className="bg-ds-surface-2">
                <tr className="border-b border-ds-border">
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-ds-muted">{t('table.userId')}</th>
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-ds-muted">{t('table.login')}</th>
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-ds-muted">{t('table.securityCode')}</th>
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-ds-muted">{t('roles.label')}</th>
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-ds-muted">{t('table.visibleMenus')}</th>
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-ds-muted">{t('table.status')}</th>
                  <th className="px-6 py-4 text-end text-xs font-bold uppercase tracking-wider text-ds-muted">{t('table.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ds-border">
                {users.map((profile) => {
                  const isSelf = profile.uid === userProfile?.uid;
                  const allowed = profile.allowedMenus || (
                    profile.role === 'admin'
                      ? MENU_OPTIONS.map(m => m.id)
                      : ['dashboard', 'pos', 'products', 'clients', 'sales', 'invoices', 'notes']
                  );

                  return (
                    <tr key={profile.uid} className={cn(
                      "group transition-colors hover:bg-ds-surface-2",
                      isSelf && "border-s-2 border-ds-brand bg-ds-brand-soft/50"
                    )}>
                      {/* Left Block: Avatar and Email/UID info */}
                      <td data-label={t('table.userId')} className="py-4 px-6">
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            "flex h-10 w-10 items-center justify-center rounded-ds-md border border-ds-brand/20 bg-ds-brand-soft text-xs font-black text-ds-brand",
                            profile.role === 'admin' && "bg-ds-brand text-ds-brand-contrast"
                          )}>
                            {profile.name ? profile.name[0].toUpperCase() : (profile.email ? profile.email[0].toUpperCase() : '?')}
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5 text-sm font-bold leading-none text-ds-text">
                              {profile.name || t('table.noName')}
                              {isSelf && (
                                <Badge variant="info" className="min-h-0 px-1.5 py-0.5 text-[10px]">
                                  {t('table.you')}
                                </Badge>
                              )}
                            </div>
                            <span className="mt-1 block break-all text-sm font-medium text-ds-muted">{profile.email}</span>
                            <div className="mt-1 space-y-0.5 break-all font-mono text-xs text-ds-muted">
                              <div>UID: {profile.uid}</div>
                              <div>{t('table.ownerId')}: {profile.ownerId || t('table.undefined')}</div>
                              {profile.creatorId && <div>{t('table.creator')}: {profile.creatorId}</div>}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Credentials Display Column with copy functions */}
                      <td data-label={t('table.login')} className="py-4 px-6">
                        <div className="space-y-1 text-xs">
                          {/* Email Copy Line */}
                          <div className="flex items-center gap-2 group/btn">
                            <span className="w-10 text-xs font-black uppercase text-ds-muted">{t('table.email')}:</span>
                            <span className="break-all text-sm font-semibold text-ds-text">{profile.email}</span>
                            <Button
                              variant="ghost"
                              onClick={() => copyToClipboard(profile.email, `${profile.uid}-email`)}
                              className="min-w-ds-touch-target"
                              size="sm"
                              aria-label={t('table.copyEmail')}
                              title={t('table.copyEmail')}
                            >
                              {copiedField === `${profile.uid}-email` ? (
                                <Check className="h-4 w-4 text-ds-success" />
                              ) : (
                                <Copy className="h-4 w-4" />
                              )}
                            </Button>
                          </div>

                          <div className="flex items-center gap-2 group/btn">
                            <Button
                              variant="secondary"
                              onClick={() => void sendPasswordResetLink(profile.email)}
                              size="sm"
                              title={t('actions.sendResetLink')}
                            >
                              <Mail className="h-4 w-4" /> {t('actions.sendResetLink')}
                            </Button>
                          </div>
                        </div>
                      </td>

                      {/* Code de sécurité individuel */}
                      <td data-label={t('table.securityCode')} className="py-4 px-6">
                        {profile.securityCode ? (
                          <div className="flex items-center gap-2 group/btn">
                            <Shield className="h-4 w-4 shrink-0 text-ds-brand" />
                            <Badge variant="neutral" className="min-h-0 rounded-ds-sm px-1.5 py-0.5 font-mono font-black tracking-widest">
                              {visibleCodes[profile.uid] ? profile.securityCode : '••••'}
                            </Badge>
                            <Button
                              variant="ghost"
                              onClick={() => toggleCodeVisibility(profile.uid)}
                              size="sm"
                              aria-label={visibleCodes[profile.uid] ? t('table.hideCode') : t('table.showCode')}
                              title={visibleCodes[profile.uid] ? t('table.hide') : t('table.show')}
                            >
                              {visibleCodes[profile.uid] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs font-bold uppercase tracking-wider text-ds-muted">{t('table.undefined')}</span>
                        )}
                      </td>

                      {/* Rôle Badge */}
                      <td data-label={t('roles.label')} className="py-4 px-6">
                        <Badge
                          variant={profile.role === 'admin' ? 'neutral' : isTechnicianProfile(profile, allowed) ? 'info' : 'neutral'}
                          className={cn("min-h-0 gap-1.5 px-2.5 py-1 uppercase tracking-wider", profile.role === 'admin' && "border-ds-brand/20 bg-ds-brand-soft text-ds-brand")}
                        >
                          <Shield className="h-3.5 w-3.5" />
                          {profile.role === 'admin' ? t('roles.adminShort') : isTechnicianProfile(profile, allowed) ? t('roles.technicianShort') : t('roles.cashierShort')}
                        </Badge>
                      </td>

                      {/* Allowed Menus List */}
                      <td data-label={t('table.visibleMenus')} className="py-4 px-6 max-w-xs">
                        <div className="flex flex-wrap gap-1">
                          {MENU_OPTIONS.map((menu) => {
                            const isAllowed = allowed.includes(menu.id);
                            return (
                              <Badge
                                key={menu.id} 
                                variant={isAllowed ? 'success' : 'neutral'}
                                className={cn(
                                  "min-h-0 rounded-ds-sm px-1.5 py-0.5 text-xs font-bold transition-all",
                                  !isAllowed && "opacity-60 line-through"
                                )}
                                title={t(`menus.${menu.id}.description`)}
                              >
                                {t(`menus.${menu.id}.shortName`)}
                              </Badge>
                            );
                          })}
                        </div>
                      </td>

                      {/* Statut Badge */}
                      <td data-label={t('table.status')} className="py-4 px-6">
                        <Badge variant={profile.status === 'banned' ? 'danger' : 'success'} className="min-h-0 px-2.5 py-1 uppercase tracking-wider">
                          {profile.status === 'banned' ? t('status.inactive') : t('status.active')}
                        </Badge>
                      </td>

                      {/* Combined Actions: Edit, Toggle Status, Delete */}
                      <td data-label={t('table.actions')} className="py-4 px-6 text-end">
                        {isSelf ? (
                          <Badge variant="info" className="min-h-0 gap-1.5 rounded-ds-md px-3 py-1.5 uppercase tracking-wider">
                            <Shield className="h-4 w-4" />
                            {t('status.primaryAccount')}
                          </Badge>
                        ) : (
                        <div className="flex items-center justify-end gap-2">
                          <div className="flex max-w-[360px] flex-wrap justify-end gap-1.5">
                            <Button
                              variant="secondary"
                              onClick={() => handleOpenEdit(profile)}
                              size="sm"
                              title={t('actions.editProfile')}
                            >
                              <Edit2 className="h-4 w-4" />
                              {t('actions.edit')}
                            </Button>
                            <Button
                              variant="secondary"
                              onClick={() => { setPasswordUser(profile); setNewPassword(''); setConfirmNewPassword(''); setErrorOnCreate(null); }}
                              size="sm"
                            >
                              <Lock className="h-4 w-4" />
                              {t('actions.changePassword')}
                            </Button>
                            <Button
                              variant="secondary"
                              onClick={() => void sendPasswordResetLink(profile.email)}
                              disabled={actionLoading === profile.uid}
                              size="sm"
                            >
                              <Mail className="h-4 w-4" />
                              {t('actions.sendResetLink')}
                            </Button>
                            <Button
                              variant={profile.status === 'banned' ? 'secondary' : 'danger'}
                              onClick={() => void handleToggleStatus(profile)}
                              disabled={actionLoading === profile.uid}
                              size="sm"
                              title={profile.status === 'banned' ? t('actions.unblockUser') : t('actions.blockUser')}
                            >
                              <Ban className="h-4 w-4" />
                              {profile.status === 'banned' ? t('actions.unblock') : t('actions.block')}
                            </Button>
                            <Button
                              variant="danger"
                              onClick={() => { setDeletingUser(profile); setDeleteConfirmation(''); setErrorOnCreate(null); }}
                              disabled={actionLoading === profile.uid}
                              size="sm"
                              title={t('actions.deleteUser')}
                            >
                              <Trash2 className="h-4 w-4" />
                              {t('actions.deletePermanently')}
                            </Button>
                          </div>
                        </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {passwordUser && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-ds-text/60 p-4 backdrop-blur-sm" role="presentation">
          <form onSubmit={handleChangeUserPassword} className="w-full min-w-0 max-w-md space-y-4 rounded-ds-lg border border-ds-border bg-ds-surface p-6 shadow-ds-md" role="dialog" aria-modal="true" aria-labelledby="change-user-password-title">
            <div>
              <h2 id="change-user-password-title" className="text-lg font-black text-ds-text">{t('changePassword.title')}</h2>
              <p className="mt-1 break-all text-sm text-ds-muted">{passwordUser.email}</p>
            </div>
            <Input label={t('changePassword.newPassword')} type="password" autoComplete="new-password" minLength={8} required value={newPassword} onChange={event => setNewPassword(event.target.value)} />
            <Input label={t('changePassword.confirmPassword')} type="password" autoComplete="new-password" minLength={8} required value={confirmNewPassword} onChange={event => setConfirmNewPassword(event.target.value)} />
            {errorOnCreate && <p role="alert" className="rounded-ds-md bg-ds-danger-soft p-3 text-sm font-semibold text-ds-danger">{errorOnCreate}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => { setPasswordUser(null); setErrorOnCreate(null); }}>{t('cancel')}</Button>
              <Button type="submit" disabled={actionLoading === passwordUser.uid || newPassword.length < 8 || newPassword !== confirmNewPassword}>{actionLoading === passwordUser.uid ? t('editing') : t('confirm')}</Button>
            </div>
          </form>
        </div>
      )}

      {deletingUser && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-ds-text/60 p-4 backdrop-blur-sm" role="presentation">
          <section className="w-full min-w-0 max-w-md space-y-4 rounded-ds-lg border border-ds-danger/20 bg-ds-surface p-6 shadow-ds-md" role="alertdialog" aria-modal="true" aria-labelledby="delete-user-title">
            <div className="flex items-start gap-3">
              <div className="rounded-ds-md bg-ds-danger-soft p-2 text-ds-danger"><AlertCircle className="h-5 w-5" /></div>
              <div>
                <h2 id="delete-user-title" className="text-lg font-black text-ds-text">{t('delete.title')}</h2>
                <p className="mt-2 text-sm leading-relaxed text-ds-text">{t('delete.confirmation')}</p>
              </div>
            </div>
            <p className="text-sm text-ds-muted">{t('delete.typeEmail')} <strong className="text-ds-text">{deletingUser.email}</strong></p>
            <Input autoFocus value={deleteConfirmation} onChange={event => setDeleteConfirmation(event.target.value)} aria-label={t('delete.confirmLabel')} />
            {deletingUser.role === 'admin' && users.filter(profile => profile.role === 'admin' && (profile.ownerId || profile.uid) === (userProfile?.ownerId || userProfile?.uid)).length <= 1 && <p role="alert" className="rounded-ds-md bg-ds-danger-soft p-3 text-sm font-semibold text-ds-danger">{t('delete.lastAdmin')}</p>}
            {errorOnCreate && <p role="alert" className="rounded-ds-md bg-ds-danger-soft p-3 text-sm font-semibold text-ds-danger">{errorOnCreate}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => { setDeletingUser(null); setDeleteConfirmation(''); setErrorOnCreate(null); }}>{t('cancel')}</Button>
              <Button type="button" variant="danger" onClick={() => void handleDeleteProfileAndAuth(deletingUser)} disabled={actionLoading === deletingUser.uid || deleteConfirmation.trim().toLowerCase() !== deletingUser.email.toLowerCase() || (deletingUser.role === 'admin' && users.filter(profile => profile.role === 'admin' && (profile.ownerId || profile.uid) === (userProfile?.ownerId || userProfile?.uid)).length <= 1)}>{actionLoading === deletingUser.uid ? t('deleting') : t('actions.deletePermanently')}</Button>
            </div>
          </section>
        </div>
      )}

      {migrationConfirmOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-ds-text/60 p-4" role="presentation">
          <section className="w-full min-w-0 max-w-md space-y-4 rounded-ds-lg bg-ds-surface p-6 shadow-ds-md" role="alertdialog" aria-modal="true">
            <h2 className="text-lg font-black text-ds-text">Confirmer la migration</h2>
            <p className="text-sm text-ds-muted">Les permissions des comptes prévisualisés seront mises à jour. Une sauvegarde JSON a été téléchargée.</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setMigrationConfirmOpen(false)}>Annuler</Button>
              <Button type="button" onClick={() => void confirmPermissionMigration()}>Confirmer la migration</Button>
            </div>
          </section>
        </div>
      )}

      {/* Creation Modal (Add User) */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-ds-text/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="my-8 w-full min-w-0 max-w-lg overflow-hidden rounded-ds-lg border border-ds-border bg-ds-surface shadow-ds-md animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-ds-border bg-ds-surface-2 px-6 py-4">
              <div className="flex items-center gap-2.5">
                <div className="rounded-ds-md bg-ds-brand-soft p-2 text-ds-brand">
                  <UserPlus className="w-4 h-4" />
                </div>
                <h2 className="text-sm font-black uppercase tracking-wider text-ds-text">{t('createModal.title')}</h2>
              </div>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setIsModalOpen(false)} 
                aria-label={t('cancel')}
              >
                <X className="h-5 w-5" />
              </Button>
            </div>

            <form onSubmit={handleCreateUser} className="max-h-[80vh] min-w-0 space-y-4 overflow-y-auto p-6">
              {errorOnCreate && (
                <div role="alert" className="flex items-center gap-2 rounded-ds-md border border-ds-danger/20 bg-ds-danger-soft p-3.5 text-sm font-bold leading-normal text-ds-danger">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {errorOnCreate}
                </div>
              )}

              <Input label={t('createModal.fullName')} type="text" required value={nameInput} onChange={(e) => setNameInput(e.target.value)} placeholder={t('createModal.nameExample')} />

              <Input label={t('createModal.loginEmail')} type="email" required value={emailInput} onChange={(e) => setEmailInput(e.target.value)} placeholder="caissier1@example.com" />

              <Input label={t('createModal.password')} type="password" required value={passwordInput} onChange={(e) => setPasswordInput(e.target.value)} placeholder={t('createModal.passwordPlaceholder')} />

              <Select
                  label={t('roles.label')}
                  value={roleInput}
                  onChange={(e) => handleRoleChangeOnCreate(e.target.value as UserFormRole)}
                >
                  <option value="user">{t('roles.custom')}</option>
                  <option value="cashier-repair">{t('roles.cashierRepair')}</option>
                  <option value="technician">{t('roles.technician')}</option>
                  <option value="admin">{t('roles.admin')}</option>
                </Select>

              {/* Menus Accesses Checkboxes */}
              <div className="space-y-2 border-t border-ds-border pt-4">
                <div>
                  <label className="block text-sm font-black uppercase tracking-wider text-ds-text">{t('createModal.allowedMenus')}</label>
                  <span className="text-sm font-medium text-ds-muted">
                    {roleInput === 'technician'
                      ? t('createModal.technicianHelp')
                      : t('createModal.menuHelp')}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {MENU_OPTIONS.filter((menu) => {
                    if (roleInput === 'technician') return TECHNICIAN_MENUS.includes(menu.id);
                    if (roleInput !== 'admin' && menu.id === 'users') return false;
                    return true;
                  }).map((menu) => {
                    const isChecked = selectedMenus.includes(menu.id);
                    return (
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={isChecked}
                        key={menu.id}
                        onClick={() => { if (roleInput !== 'technician' || TECHNICIAN_MENUS.includes(menu.id)) handleToggleMenuSelection(menu.id); }}
                        className={cn(
                          "flex min-w-0 items-start gap-2.5 rounded-ds-md border p-3 text-start transition-colors hover:bg-ds-surface-2",
                          isChecked 
                            ? "border-ds-brand/30 bg-ds-brand-soft text-ds-brand"
                            : "border-ds-border bg-ds-surface text-ds-text"
                        )}
                      >
                        <div className={cn(
                          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors",
                          isChecked 
                            ? "border-ds-brand bg-ds-brand text-ds-brand-contrast"
                            : "border-ds-border bg-ds-surface"
                        )}>
                          {isChecked && <Check className="w-3 h-3 stroke-[3.5]" />}
                        </div>
                        <div>
                          <div className="text-sm font-extrabold leading-tight">
                            {t(`menus.${menu.id}.name`)}
                          </div>
                          <p className="mt-0.5 text-sm leading-normal text-ds-muted">{t(`menus.${menu.id}.description`)}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
                {roleInput !== 'admin' && renderPermissionOptions(selectedMenus, permissionsInput, setPermissionsInput)}
              </div>

              {/* Submit / Action Buttons */}
              <div className="flex gap-3 border-t border-ds-border pt-4 font-sans">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1"
                >
                  {t('cancel')}
                </Button>
                <Button
                  type="submit"
                  disabled={actionLoading !== null}
                  className="flex-1"
                >
                  {actionLoading === 'creating' ? t('createModal.creating') : t('createModal.submit')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Unified Edit Modal */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-ds-text/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="my-8 w-full min-w-0 max-w-lg overflow-hidden rounded-ds-lg border border-ds-border bg-ds-surface shadow-ds-md animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-ds-border bg-ds-surface-2 px-6 py-4">
              <div className="flex items-center gap-2.5">
                <div className="rounded-ds-md bg-ds-brand-soft p-2 text-ds-brand">
                  <Edit2 className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-black uppercase tracking-wider text-ds-text">{t('editModal.title')}</h2>
                  <p className="mt-0.5 break-all text-sm font-bold text-ds-muted">{editingUser.email}</p>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setEditingUser(null)} 
                aria-label={t('cancel')}
              >
                <X className="h-5 w-5" />
              </Button>
            </div>

            <form onSubmit={handleSaveEdit} className="max-h-[80vh] min-w-0 space-y-4 overflow-y-auto p-6">
              {errorOnEdit && (
                <div role="alert" className="flex items-center gap-2 rounded-ds-md border border-ds-danger/20 bg-ds-danger-soft p-3.5 text-sm font-bold leading-normal text-ds-danger">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {errorOnEdit}
                </div>
              )}

              <Input label={t('createModal.fullName')} type="text" required value={editName} onChange={(e) => setEditName(e.target.value)} placeholder={t('createModal.nameExample')} />

              <Input label={t('createModal.loginEmail')} type="email" value={editEmail} readOnly />

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-ds-md border border-ds-info/20 bg-ds-accent-soft p-3 text-sm text-ds-text">
                <span>{t('editModal.passwordResetHelp')}</span>
                <Button type="button" variant="secondary" onClick={() => void sendPasswordResetLink(editingUser.email)} className="shrink-0">
                  {t('actions.sendResetLink')}
                </Button>
              </div>

              {/* Code de sécurité individuel (modification/suppression) */}
              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5 text-sm font-black uppercase tracking-wider text-ds-danger">
                  <Shield className="w-3.5 h-3.5" />
                  Code de sécurité (4 chiffres)
                </label>
                <div className="relative">
                  <Input
                    aria-label="Code de sécurité (4 chiffres)"
                    type="text"
                    maxLength={4}
                    inputMode="numeric"
                    value={editSecurityCode}
                    onChange={(e) => setEditSecurityCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
                    placeholder="Ex: 1234 (laisser vide = aucun)"
                    className="font-mono font-black tracking-[0.3em]"
                  />
                </div>
                <p className="text-sm font-medium leading-relaxed text-ds-muted">
                  Ce code sera demandé à cet utilisateur avant toute modification ou suppression. Laisser vide pour ne définir aucun code.
                </p>
              </div>

              {/* Role */}
              <Select
                  label={t('roles.label')}
                  value={editRole}
                  onChange={(e) => {
                    const newRole = e.target.value as UserFormRole;
                    setEditRole(newRole);
                    if (newRole === 'technician') {
                      setEditSelectedMenus(TECHNICIAN_MENUS);
                    } else if (newRole === 'cashier-repair') {
                      setEditSelectedMenus(CASHIER_REPAIR_MENUS);
                    } else if (newRole === 'user') {
                      setEditSelectedMenus((prev) => ['technician', 'cashier-repair'].includes(editRole)
                        ? DEFAULT_USER_MENUS
                        : prev.filter((mid) => mid !== 'users'));
                    } else if (newRole === 'admin') {
                      setEditSelectedMenus(MENU_OPTIONS.map((m) => m.id));
                    }
                    setEditPermissions(permissionsForPreset(presetFromRole(newRole)));
                  }}
                >
                  <option value="user">{t('roles.custom')}</option>
                  <option value="cashier-repair">{t('roles.cashierRepair')}</option>
                  <option value="technician">{t('roles.technician')}</option>
                  <option value="admin">{t('roles.admin')}</option>
                </Select>

              {/* Status */}
              <Select
                  label="Statut du compte"
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value as 'active' | 'banned')}
                >
                  <option value="active">{t('editModal.statusActive')}</option>
                  <option value="banned">{t('editModal.statusBanned')}</option>
                </Select>

              {/* Menu privileges checkboxes */}
              <div className="space-y-2 border-t border-ds-border pt-4">
                <div>
                  <label className="block text-sm font-black uppercase tracking-wider text-ds-text">{t('editModal.allowedMenus')}</label>
                  <span className="text-sm font-medium text-ds-muted">{t('editModal.allowedMenusHelp')}</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {MENU_OPTIONS.filter((menu) => {
                    if (editRole === 'technician') return TECHNICIAN_MENUS.includes(menu.id);
                    if (editRole === 'user' && menu.id === 'users') return false;
                    return true;
                  }).map((menu) => {
                    const isChecked = editSelectedMenus.includes(menu.id);
                    return (
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={isChecked}
                        key={menu.id}
                        onClick={() => { if (editRole !== 'technician' || TECHNICIAN_MENUS.includes(menu.id)) handleToggleEditMenuSelection(menu.id); }}
                        className={cn(
                          "flex min-w-0 items-start gap-2.5 rounded-ds-md border p-3 text-start transition-colors hover:bg-ds-surface-2",
                          isChecked 
                            ? "border-ds-brand/30 bg-ds-brand-soft text-ds-brand"
                            : "border-ds-border bg-ds-surface text-ds-text"
                        )}
                      >
                        <div className={cn(
                          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors",
                          isChecked 
                            ? "border-ds-brand bg-ds-brand text-ds-brand-contrast"
                            : "border-ds-border bg-ds-surface"
                        )}>
                          {isChecked && <Check className="w-3 h-3 stroke-[3.5]" />}
                        </div>
                        <div>
                          <div className="text-sm font-extrabold leading-tight">
                            {t(`menus.${menu.id}.name`)}
                          </div>
                          <p className="mt-0.5 text-sm leading-normal text-ds-muted">{t(`menus.${menu.id}.description`)}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
                {editRole !== 'admin' && renderPermissionOptions(editSelectedMenus, editPermissions, setEditPermissions)}
              </div>

              {/* Save Buttons */}
              <div className="flex gap-3 border-t border-ds-border pt-4">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setEditingUser(null)}
                  className="flex-1"
                >
                  Annuler
                </Button>
                <Button
                  type="submit"
                  disabled={actionLoading !== null}
                  className="flex-1"
                >
                  {actionLoading === 'editing' ? 'Enregistrement...' : 'Enregistrer'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
