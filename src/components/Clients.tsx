import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, orderBy, where, getDocs, runTransaction, serverTimestamp } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { db, auth } from '../firebase';
import { Client, StoreSettings, UserProfile } from '../types';
import { handleFirestoreError, OperationType } from '../App';
import { Plus, Search, Edit2, Trash2, X, Phone, MapPin, Wallet, Coins, AlertCircle, CheckCircle } from 'lucide-react';
import { can, hasMenuAccess } from '../lib/permissions';
import { addCashSessionTotals, requireOpenCashSession, useCashSession } from '../lib/cashSessions';
import { createClient } from '../lib/clients';
import MessageComposer from './MessageComposer';
import { useBrand } from './BrandProvider';
import { Badge, Button, Card, EmptyState, Input, PageHeader, Select } from './ui';

interface ClientsProps {
  userProfile: UserProfile | null;
}

export default function Clients({ userProfile }: ClientsProps) {
  const { t } = useTranslation('clients');
  const brand = useBrand();
  const navigate = useNavigate();
  const { session: cashSession, loading: cashSessionLoading } = useCashSession(userProfile);
  const [clients, setClients] = useState<Client[]>([]);
  const [storeSettings, setStoreSettings] = useState<StoreSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [onlyWithDebt, setOnlyWithDebt] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);

  const ownerId = (userProfile?.role === 'admin' ? userProfile?.uid : userProfile?.ownerId) || userProfile?.uid || auth.currentUser?.uid;
  const canAddEdit = can(userProfile, 'clients', 'addEdit');
  const canDelete = can(userProfile, 'clients', 'delete');
  const canCash = hasMenuAccess(userProfile, 'pos');

  // Settlement state
  const [isSettleModalOpen, setIsSettleModalOpen] = useState(false);
  const [settlingClient, setSettlingClient] = useState<Client | null>(null);
  const [settleAmountInput, setSettleAmountInput] = useState('');
  const [settleAmount, setSettleAmount] = useState<number>(0);
  const [settleMode, setSettleMode] = useState('Espèces');
  const [settleError, setSettleError] = useState('');

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    phone: '',
    address: '',
    debt: 0
  });

  const [debtInput, setDebtInput] = useState('');

  useEffect(() => {
    if (!auth.currentUser || !ownerId) return;
    const q = query(collection(db, 'clients'), where('ownerId', '==', ownerId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const cls = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Client));
      cls.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      setClients(cls);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'clients');
    });

    const unsubscribeSettings = onSnapshot(doc(db, 'settings', ownerId), (snapshot) => {
      if (snapshot.exists()) {
        setStoreSettings(snapshot.data() as StoreSettings);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'settings');
    });

    return () => {
      unsubscribe();
      unsubscribeSettings();
    };
  }, [ownerId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canAddEdit) return;
    try {
      if (editingClient) {
        await updateDoc(doc(db, 'clients', editingClient.id), {
          ...formData,
          ownerId,
          userId: userProfile?.uid || ownerId
        });
      } else {
        await createClient(formData, ownerId, userProfile?.uid || ownerId);
      }
      closeModal();
    } catch (error) {
      handleFirestoreError(error, editingClient ? OperationType.UPDATE : OperationType.CREATE, 'clients');
    }
  };

  const handleDelete = async (id: string) => {
    if (!canDelete) return;
    if (!confirm(t('deleteConfirm'))) return;
    try {
      await deleteDoc(doc(db, 'clients', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'clients');
    }
  };

  const openModal = (client?: Client) => {
    if (client) {
      setEditingClient(client);
      setFormData({
        name: client.name,
        code: client.code || '',
        phone: client.phone || '',
        address: client.address || '',
        debt: client.debt
      });
      setDebtInput(client.debt.toString());
    } else {
      setEditingClient(null);
      setFormData({
        name: '',
        code: '',
        phone: '',
        address: '',
        debt: 0
      });
      setDebtInput('');
    }
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingClient(null);
  };

  const openSettleModal = (client: Client) => {
    setSettlingClient(client);
    setSettleAmountInput('');
    setSettleAmount(0);
    setSettleMode('Espèces');
    setSettleError('');
    setIsSettleModalOpen(true);
  };

  const closeSettleModal = () => {
    setIsSettleModalOpen(false);
    setSettlingClient(null);
  };

  const handleSettleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!settlingClient) return;
    if (!cashSession || cashSessionLoading) {
      setSettleError(cashSessionLoading
        ? t('errors.cashChecking')
        : t('errors.cashRequired'));
      return;
    }
    if (!Number.isFinite(settleAmount) || settleAmount <= 0 || settleAmount > settlingClient.debt) {
      setSettleError(t('errors.amountInvalid'));
      return;
    }
    try {
      // Répartir le règlement sur les ventes impayées du client (les plus anciennes d'abord),
      // afin que l'historique des transactions reflète le paiement au lieu de rester "dette".
      const salesSnap = await getDocs(query(
        collection(db, 'sales'),
        where('ownerId', '==', ownerId),
        where('clientId', '==', settlingClient.id)
      ));

      const parseSaleDate = (d: any): number => {
        if (!d) return 0;
        if (typeof d.toDate === 'function') return d.toDate().getTime();
        const t = new Date(d).getTime();
        return isNaN(t) ? 0 : t;
      };

      const unpaidSales = salesSnap.docs
        .map(d => ({ ref: d.ref, data: d.data() as any }))
        .filter(s => (s.data.debt || 0) > 0.0005)
        .sort((a, b) => parseSaleDate(a.data.date) - parseSaleDate(b.data.date));

      const clientRef = doc(db, 'clients', settlingClient.id);
      const paymentRef = doc(collection(db, 'client_debts'));
      await runTransaction(db, async transaction => {
        const activeSession = await requireOpenCashSession(
          transaction,
          userProfile?.uid || auth.currentUser?.uid || '',
          ownerId || '',
        );
        const clientSnapshot = await transaction.get(clientRef);
        const saleSnapshots = await Promise.all(unpaidSales.map(sale => transaction.get(sale.ref)));
        if (!clientSnapshot.exists()) throw new Error('Client introuvable.');
        const currentDebt = Number(clientSnapshot.data().debt) || 0;
        if (settleAmount > currentDebt + 0.001) {
          throw new Error(t('errors.debtChanged'));
        }
        let remaining = settleAmount;
        saleSnapshots.forEach((saleSnapshot, index) => {
          if (!saleSnapshot.exists() || remaining <= 0.0005) return;
          const sale = saleSnapshot.data();
          const saleDebt = Number(sale.debt) || 0;
          if (saleDebt <= 0) return;
          const payment = Math.min(remaining, saleDebt);
          const newSaleDebt = Math.round((saleDebt - payment) * 1000) / 1000;
          const newSalePaid = Math.round(((Number(sale.paid) || 0) + payment) * 1000) / 1000;
          transaction.update(unpaidSales[index].ref, { debt: newSaleDebt, paid: newSalePaid });
          if (sale.invoiceId) {
            transaction.update(doc(db, 'invoices', sale.invoiceId), { debt: newSaleDebt, paid: newSalePaid });
          }
          remaining = Math.round((remaining - payment) * 1000) / 1000;
        });
        transaction.update(clientRef, { debt: Math.max(0, currentDebt - settleAmount) });
        transaction.set(paymentRef, {
          ownerId,
          clientId: settlingClient.id,
          type: 'encaissement_dette',
          reference: settlingClient.name,
          amount: settleAmount,
          mode: settleMode,
          date: serverTimestamp(),
          by: userProfile?.uid || auth.currentUser?.uid,
          sessionId: activeSession.id,
        });
        addCashSessionTotals(transaction, activeSession, {
          debtsCollected: settleAmount,
          debtsCollectedCash: settleMode === 'Espèces' ? settleAmount : 0,
        });
      });
      closeSettleModal();
    } catch (error) {
      setSettleError(error instanceof Error ? error.message : t('errors.paymentFailed'));
    }
  };

  const filteredClients = clients.filter(c => {
    const matchesSearch = c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.code?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.phone?.includes(searchTerm);
    
    if (onlyWithDebt) {
      return matchesSearch && c.debt > 0;
    }
    return matchesSearch;
  });

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={canAddEdit && <Button onClick={() => openModal()}>
          <Plus className="h-4 w-4" />
          {t('newClient')}
        </Button>}
      />
      <Card className="overflow-hidden p-0">
        <div className="flex flex-col gap-4 border-b border-ds-border bg-ds-surface-2 p-4 md:flex-row md:items-center md:justify-between sm:p-5">
          <div className="relative min-w-0 flex-1 sm:max-w-md">
            <Search className="absolute start-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-ds-muted" />
            <Input
              type="text"
              placeholder={t('search')}
              aria-label={t('searchAria')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="ps-11"
            />
          </div>
          <Button
            variant="secondary"
            onClick={() => setOnlyWithDebt(!onlyWithDebt)}
            aria-pressed={onlyWithDebt}
            className={onlyWithDebt ? 'border-ds-warning bg-ds-warning-soft text-ds-warning' : ''}
          >
            <Coins className="h-4 w-4" />
            <span>{t('debtOnly')}</span>
            {onlyWithDebt && <Badge variant="warning" className="min-h-0 px-2 py-0">{clients.filter(c => c.debt > 0).length}</Badge>}
          </Button>
        </div>

        <div className="overflow-x-auto text-[13px] font-medium text-ds-text-muted">
          <table className="responsive-card-table w-full min-w-[560px] border-collapse text-start">
            <thead>
              <tr className="border-b border-ds-border bg-ds-surface-2 text-[10px] font-extrabold uppercase tracking-widest text-ds-muted">
                <th className="px-6 py-4">{t('clientContact')}</th>
                <th className="px-6 py-4">{t('currentDebt')}</th>
                <th className="px-6 py-4 text-end">{t('actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ds-border">
              {loading ? (
                <tr>
                  <td colSpan={3} className="px-6 py-10"><EmptyState title={t('loading')} /></td>
                </tr>
              ) : filteredClients.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-6 py-10"><EmptyState title={t('empty')} /></td>
                </tr>
              ) : (
                filteredClients.map((client) => (
                  <tr key={client.id} className="transition-colors hover:bg-ds-surface-2">
                    <td data-label={t('clientContact')} className="px-6 py-4">
                      <div className="font-medium text-ds-text">{client.name}</div>
                      {client.code && <div className="text-[10px] font-mono uppercase tracking-tighter text-ds-muted">{t('code')}: {client.code}</div>}
                      {client.address && (
                        <div className="mt-1 flex items-center gap-1 text-xs text-ds-muted">
                          <MapPin className="w-3 h-3" />
                          {client.address}
                        </div>
                      )}
                      {client.phone ? (
                        <div className="mt-1 flex items-center gap-1 text-sm text-ds-text-muted">
                          <Phone className="w-3 h-3" />
                          {client.phone}
                        </div>
                      ) : (
                        <span className="mt-1 block text-xs italic text-ds-muted">{t('notProvided')}</span>
                      )}
                    </td>
                    <td data-label={t('currentDebt')} className="px-6 py-4">
                      <Badge variant={client.debt > 0 ? 'warning' : 'neutral'} className="font-mono text-sm">
                        <Wallet className="me-1.5 h-4 w-4 shrink-0" />
                        {client.debt.toFixed(3)} {storeSettings?.currency || 'DT'}
                      </Badge>
                    </td>
                    <td data-label={t('actions')} className="px-6 py-4 text-end">
                      <div className="flex items-center justify-end gap-2">
                        <MessageComposer
                          phone={client.phone}
                          clientName={client.name}
                          montantRestant={`${(Number(client.debt) || 0).toFixed(3)} ${storeSettings?.currency || 'DT'}`}
                          nomMagasin={storeSettings?.storeName || brand.storeName}
                          indicatif={storeSettings?.whatsappCountryCode || '216'}
                          templates={storeSettings?.messageTemplates}
                          defaultTemplate="rappel_paiement"
                        />
                        {canCash && client.debt > 0 && (
                          <Button variant="ghost" size="sm" onClick={() => openSettleModal(client)}                           title={t('settleDebt')} aria-label={t('settleDebt')}>
                            <Coins className="h-4 w-4 text-ds-success" />
                          </Button>
                        )}
                        {canAddEdit && <Button variant="ghost" size="sm" onClick={() => openModal(client)} aria-label={t('edit')}>
                          <Edit2 className="h-4 w-4 text-ds-info" />
                        </Button>}
                        {canDelete && <Button variant="ghost" size="sm" onClick={() => handleDelete(client.id)} aria-label={t('delete')}>
                          <Trash2 className="h-4 w-4 text-ds-danger" />
                        </Button>}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Modal */}
      {canAddEdit && isModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <Card className="w-full max-w-md overflow-hidden p-0 shadow-ds-md">
            <div className="flex items-center justify-between border-b border-ds-border bg-ds-surface-2 px-6 py-4">
              <h2 className="text-lg font-bold text-ds-text">
                {editingClient ? t('edit') : t('newClient')}
              </h2>
              <Button variant="ghost" size="sm" onClick={closeModal} aria-label={t('close')}><X className="h-5 w-5" /></Button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 p-6">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input
                  label={t('fullName')}
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder={t('nameExample')}
                />
                <Input
                  label={t('clientCode')}
                  type="text"
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                  placeholder="CLI-001"
                />
              </div>
              <Input
                label={t('phone')}
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder={t('phoneExample')}
              />
              <Input
                label={t('address')}
                type="text"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                placeholder={t('addressExample')}
              />
              <Input
                label={`${t('initialDebt')} (${storeSettings?.currency || 'DT'})`}
                type="text"
                inputMode="decimal"
                value={debtInput}
                onChange={(e) => {
                  const value = e.target.value.replace(',', '.');
                  if (value === '' || /^\d*\.?\d*$/.test(value)) {
                    setDebtInput(value);
                    setFormData({ ...formData, debt: parseFloat(value) || 0 });
                  }
                }}
                onBlur={() => {
                  const parsed = parseFloat(debtInput) || 0;
                  setDebtInput(parsed.toString());
                  setFormData({ ...formData, debt: parsed });
                }}
                placeholder="0.00"
              />

              <div className="flex gap-3 pt-4">
                <Button type="button" variant="secondary" className="flex-1" onClick={closeModal}>{t('cancel')}</Button>
                <Button type="submit" className="flex-1">{editingClient ? t('save') : t('add')}</Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {canCash && isSettleModalOpen && settlingClient && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <Card className="w-full max-w-md overflow-hidden p-0 shadow-ds-md">
            <div className="flex items-center justify-between border-b border-ds-border bg-ds-surface-2 px-6 py-4">
              <h2 className="flex items-center gap-2 text-lg font-bold text-ds-text">
                <Coins className="h-5 w-5 text-ds-success" />
                {t('settleDebt')}
              </h2>
              <Button variant="ghost" size="sm" onClick={closeSettleModal} aria-label={t('close')}><X className="h-5 w-5" /></Button>
            </div>

            <div className="space-y-5 p-6">
              <div className="space-y-2 rounded-ds-md border border-ds-border bg-ds-surface-2 p-4">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold uppercase tracking-wider text-ds-muted">{t('client')}</span>
                  <span className="font-bold text-ds-text">{settlingClient.name}</span>
                </div>
                {settlingClient.code && (
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-bold uppercase tracking-wider text-ds-muted">{t('code')}</span>
                    <span className="font-mono text-ds-text-muted">{settlingClient.code}</span>
                  </div>
                )}
                <div className="flex justify-between items-center border-t border-ds-border pt-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-ds-warning">{t('totalDebt')}</span>
                  <span className="font-mono text-xl font-black text-ds-warning">
                    {settlingClient.debt.toFixed(3)} {storeSettings?.currency || 'DT'}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  className={settleAmount < settlingClient.debt && settleAmountInput !== '' || settleAmountInput === ''
                    ? 'border-ds-warning bg-ds-warning-soft text-ds-warning'
                    : ''}
                  onClick={() => {
                    setSettleAmountInput('');
                    setSettleAmount(0);
                  }}
                >
                  <AlertCircle className="h-5 w-5" />
                  {t('partialPayment')}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className={settleAmount >= settlingClient.debt
                    ? 'border-ds-success bg-ds-success text-ds-brand-contrast hover:brightness-90'
                    : 'text-ds-success'}
                  onClick={() => {
                    setSettleAmountInput(settlingClient.debt.toFixed(3));
                    setSettleAmount(settlingClient.debt);
                  }}
                >
                  <CheckCircle className="h-5 w-5" />
                  {t('payInFull')}
                </Button>
              </div>

              <Input
                label={`${t('amountPaid')} (${storeSettings?.currency || 'DT'})`}
                type="text"
                inputMode="decimal"
                value={settleAmountInput}
                onFocus={(e) => e.target.select()}
                onChange={(e) => {
                  const value = e.target.value.replace(',', '.');
                  if (value === '' || /^\d*\.?\d*$/.test(value)) {
                    setSettleAmountInput(value);
                    setSettleAmount(parseFloat(value) || 0);
                  }
                }}
                placeholder={t('amountPlaceholder')}
              />

              <Select label={t('paymentMode')} value={settleMode} onChange={event => setSettleMode(event.target.value)}>
                <option value="Espèces">{t('cash')}</option><option value="Carte">{t('card')}</option><option value="Virement">{t('transfer')}</option>
              </Select>

              {settleError && <div role="alert" className="rounded-ds-md bg-ds-danger-soft p-3 text-xs font-semibold text-ds-danger">
                {settleError}
                {!cashSession && !cashSessionLoading && <button type="button" onClick={() => navigate('/cash-session')} className="ms-2 underline">{t('openCash')}</button>}
              </div>}

              {settleAmount > 0 && settleAmount < settlingClient.debt && (
                <Card className="space-y-2 border-ds-warning/30 bg-ds-warning-soft p-4">
                  <div className="flex justify-between items-center text-xs font-bold uppercase tracking-wider text-ds-warning">
                    <span>{t('amountPaid')}</span>
                    <span className="font-mono">{settleAmount.toFixed(3)} {storeSettings?.currency || 'DT'}</span>
                  </div>
                  <div className="flex justify-between items-center border-t border-ds-warning/20 pt-2 text-sm font-black text-ds-warning">
                    <span>{t('remaining')}</span>
                    <span className="font-mono">{(settlingClient.debt - settleAmount).toFixed(3)} {storeSettings?.currency || 'DT'}</span>
                  </div>
                </Card>
              )}

              {settleAmount >= settlingClient.debt && settleAmount > 0 && (
                <Badge variant="success" className="w-full justify-center rounded-ds-md">
                  <CheckCircle className="me-2 h-4 w-4" />
                  {t('debtPaid')}
                </Badge>
              )}

              <div className="flex gap-3 pt-1">
                <Button type="button" variant="secondary" className="flex-1" onClick={closeSettleModal}>{t('cancel')}</Button>
                <Button type="button" className="flex-1" onClick={handleSettleSubmit} disabled={settleAmount <= 0}>{t('validatePayment')}</Button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
