import { useState, useEffect } from 'react';
import { collection, onSnapshot, query, orderBy, limit, doc, getDoc, where, deleteDoc, setDoc, updateDoc, runTransaction, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { apiFetch } from '../lib/api';
import { Sale, Invoice, UserProfile, Product } from '../types';
import { formatProductDetails } from '../config/productAttributes';
import { handleFirestoreError, OperationType } from '../App';
import { Search, Calendar, User, ShoppingBag, Eye, X, Printer, Download, TrendingUp, Receipt, AlertCircle, CheckCircle2, Clock, Trash2, Shield, EyeOff, Package } from 'lucide-react';
import { cn } from '../lib/utils';
import { addPendingOperation } from '../lib/offlineManager';
import { computeSaleProfit } from '../lib/financial';
import { getAuditActor, logAudit } from '../lib/audit';
import { slugifyAppName } from '../lib/brand';
import { useBrand } from './BrandProvider';
import { Badge, Button, Card, EmptyState, Input, PageHeader } from './ui';
import { useTranslation } from 'react-i18next';
import { formatDateTime, formatDocumentDate, formatNumber } from '../i18n/format';

interface SalesProps {
  userProfile: UserProfile | null;
}

export default function Sales({ userProfile }: SalesProps) {
  const { t } = useTranslation('sales');
  const brand = useBrand();
  const [sales, setSales] = useState<Sale[]>([]);
  const [saleCostSnapshots, setSaleCostSnapshots] = useState<Record<string, Array<{ productId: string; quantity: number; unitBuyPrice: number | null }>>>({});
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [productCode, setProductCode] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [filterStatus, setFilterStatus] = useState<'all' | 'paid' | 'partial'>('all');

  // Deletion states
  const [saleToDelete, setSaleToDelete] = useState<Sale | null>(null);
  const [showSecurityModal, setShowSecurityModal] = useState(false);
  const [securityCode, setSecurityCode] = useState('');
  const [securityError, setSecurityError] = useState(false);
  const [showSecurityInput, setShowSecurityInput] = useState(false);
  const [pendingDeleteSale, setPendingDeleteSale] = useState<Sale | null>(null);
  const [deleting, setDeleting] = useState(false);

  const ownerId = userProfile?.ownerId || userProfile?.uid || 'no_user_auth';

  const handleDeleteConfirm = async () => {
    if (!saleToDelete) return;
    setDeleting(true);
    
    const isOffline = !navigator.onLine;
    const userEmail = userProfile?.email || 'unknown';
    const userName = userProfile?.name || 'unknown';
    const actor = getAuditActor(userProfile, userProfile?.uid || ownerId);

    try {
      if (isOffline) {
        // --- OFFLINE DELETE FLOW ---
        // 1. Revert stock locally
        for (const item of saleToDelete.items) {
          const productRef = doc(db, 'products', item.productId);
          const productSnap = await getDoc(productRef);
          if (productSnap.exists()) {
            const currentStock = productSnap.data().stock || 0;
            await updateDoc(productRef, { stock: currentStock + item.quantity });
          }
        }

        // 2. Revert client debt locally
        if (saleToDelete.clientId && saleToDelete.debt > 0) {
          const clientRef = doc(db, 'clients', saleToDelete.clientId);
          const clientSnap = await getDoc(clientRef);
          if (clientSnap.exists()) {
            const currentDebt = clientSnap.data().debt || 0;
            await updateDoc(clientRef, { debt: Math.max(0, currentDebt - saleToDelete.debt) });
          }
        }

        // 3. Delete invoice locally
        let invoiceNumber = 'N/A';
        if (saleToDelete.invoiceId) {
          const invoiceRef = doc(db, 'invoices', saleToDelete.invoiceId);
          const invoiceSnap = await getDoc(invoiceRef);
          if (invoiceSnap.exists()) {
            invoiceNumber = invoiceSnap.data().number || 'N/A';
          }
          await deleteDoc(doc(db, 'invoices', saleToDelete.invoiceId));
        }

        // 4. Create Audit Log locally (optionnel — ne bloque pas la suppression)
        try {
          const logRef = doc(collection(db, 'audit_logs'));
          await setDoc(logRef, {
            action: 'DELETE_SALE',
            userEmail,
            userName,
            timestamp: new Date().toISOString(),
            ticketId: saleToDelete.id,
            invoiceId: saleToDelete.invoiceId || 'N/A',
            invoiceNumber,
            total: saleToDelete.total,
            ownerId,
            userId: userProfile?.uid || ownerId
          });
        } catch (logErr) {
          console.warn('[AUDIT LOG OFFLINE] Failed:', logErr);
        }

        // 5. Delete sale locally
        await deleteDoc(doc(db, 'sales', saleToDelete.id));
        await Promise.all([
          logAudit({
            ownerId,
            entity: 'sale',
            entityId: saleToDelete.id,
            action: 'delete',
            actor,
            summary: { before: { total: saleToDelete.total, client: saleToDelete.clientName, status: 'deleted' } },
          }),
          ...(saleToDelete.invoiceId ? [logAudit({
            ownerId,
            entity: 'invoice' as const,
            entityId: saleToDelete.invoiceId,
            action: 'delete' as const,
            actor,
            summary: { before: { total: saleToDelete.total, client: saleToDelete.clientName, status: 'deleted' } },
          })] : []),
        ]);

        // 6. Queue offline sync
        addPendingOperation('DELETE_SALE', {
          saleId: saleToDelete.id,
          userEmail,
          userName
        });

      } else {
        // --- ONLINE DELETE FLOW ---
        // writeBatch : atomique mais sans les contraintes read-before-write de runTransaction

        // ── PHASE 1 : READS ──────────────────────────────────────────────
        const saleRef = doc(db, 'sales', saleToDelete.id);
        const saleSnap = await getDoc(saleRef);
        if (!saleSnap.exists()) throw new Error("Cette vente n'existe plus.");

        // Lire les stocks actuels
        const productData: { ref: ReturnType<typeof doc>, newStock: number }[] = [];
        for (const item of saleToDelete.items) {
          try {
            const productRef = doc(db, 'products', item.productId);
            const productSnap = await getDoc(productRef);
            if (productSnap.exists()) {
              const currentStock = productSnap.data().stock || 0;
              productData.push({ ref: productRef, newStock: currentStock + item.quantity });
            }
          } catch (e) { console.warn('stock read failed:', e); }
        }

        // Lire la dette client
        let clientRef = null;
        let newDebt = 0;
        if (saleToDelete.clientId && saleToDelete.debt > 0) {
          try {
            clientRef = doc(db, 'clients', saleToDelete.clientId);
            const clientSnap = await getDoc(clientRef);
            if (clientSnap.exists()) {
              const currentDebt = clientSnap.data().debt || 0;
              newDebt = Math.max(0, currentDebt - saleToDelete.debt);
            }
          } catch (e) { console.warn('client debt read failed:', e); clientRef = null; }
        }

        // Lire la facture
        let invoiceRef = null;
        let invoiceNumber = 'N/A';
        if (saleToDelete.invoiceId) {
          try {
            invoiceRef = doc(db, 'invoices', saleToDelete.invoiceId);
            const invoiceSnap = await getDoc(invoiceRef);
            if (invoiceSnap.exists()) {
              invoiceNumber = invoiceSnap.data().number || 'N/A';
            }
          } catch (e) { console.warn('invoice read failed:', e); invoiceRef = null; }
        }

        // ── PHASE 2 : WRITES séquentiels ────────────────────────────────

        // Restaurer stocks (updateDoc simple, pas de batch)
        for (const { ref, newStock } of productData) {
          try { await updateDoc(ref, { stock: newStock }); } catch (e) { console.warn('stock update failed:', e); }
        }

        // Restaurer dette client
        if (clientRef) {
          try { await updateDoc(clientRef, { debt: newDebt }); } catch (e) { console.warn('debt update failed:', e); }
        }

        // Supprimer facture
        if (invoiceRef) {
          try { await deleteDoc(invoiceRef); } catch (e) { console.warn('invoice delete failed:', e); }
        }

        // Supprimer la vente (opération principale)
        await deleteDoc(saleRef);
        await Promise.all([
          logAudit({
            ownerId,
            entity: 'sale',
            entityId: saleToDelete.id,
            action: 'delete',
            actor,
            summary: { before: { total: saleToDelete.total, client: saleToDelete.clientName, status: 'deleted' } },
          }),
          ...(saleToDelete.invoiceId ? [logAudit({
            ownerId,
            entity: 'invoice' as const,
            entityId: saleToDelete.invoiceId,
            action: 'delete' as const,
            actor,
            summary: { before: { total: saleToDelete.total, client: saleToDelete.clientName, status: 'deleted' } },
          })] : []),
        ]);

        // Log d'audit (optionnel)
        try {
          const logRef = doc(collection(db, 'audit_logs'));
          await setDoc(logRef, {
            action: 'DELETE_SALE',
            userEmail,
            userName,
            timestamp: new Date().toISOString(),
            ticketId: saleToDelete.id,
            invoiceId: saleToDelete.invoiceId || 'N/A',
            invoiceNumber,
            total: saleToDelete.total,
            ownerId,
            userId: userProfile?.uid || ownerId
          });
        } catch (logErr) {
          console.warn('[AUDIT LOG] Failed:', logErr);
        }
      }

      setSaleToDelete(null);
    } catch (err: any) {
      console.error("Failed to delete sale:", err);
      alert(t('deleteFailed', { message: err.message }));
    } finally {
      setDeleting(false);
    }
  };

  const downloadPDF = async (sale: Sale) => {
    try {
      if (!sale.invoiceId) {
        alert(t('noInvoice'));
        return;
      }
      const invoiceSnap = await getDoc(doc(db, 'invoices', sale.invoiceId));
      if (!invoiceSnap.exists()) {
        alert(t('invoiceMissing'));
        return;
      }
      const invoice = { id: invoiceSnap.id, ...invoiceSnap.data() } as Invoice;
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error(t('sessionInvalid'));
      const [idToken, settingsSnap] = await Promise.all([
        currentUser.getIdToken(),
        getDoc(doc(db, 'settings', ownerId))
      ]);
      const storeSettings = settingsSnap.exists() ? settingsSnap.data() : {};
      const response = await apiFetch('/invoices/pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({
          ...invoice,
          storeName: storeSettings.storeName || brand.storeName,
          address: storeSettings.address,
          phone: storeSettings.phone,
          documentLanguage: storeSettings.documentLanguage || 'fr',
          date: formatDocumentDate(invoice.date?.toDate ? invoice.date.toDate() : new Date(), storeSettings.documentLanguage || 'fr')
        })
      });
      if (!response.ok) throw new Error(t('pdfFailed'));
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${slugifyAppName(brand.storeName)}-facture-${invoice.number}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (error) {
      console.error('Erreur PDF:', error);
    }
  };

  useEffect(() => {
    if (!auth.currentUser || !userProfile) return;
    const tenantOwnerId = userProfile.ownerId || userProfile.uid;
    const q = query(collection(db, 'sales'), where('ownerId', '==', tenantOwnerId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const sls = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Sale));
      sls.sort((a, b) => {
        const timeA = a.date?.seconds || 0;
        const timeB = b.date?.seconds || 0;
        return timeB - timeA;
      });
      setSales(sls);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'sales');
      setLoading(false);
    });
    return unsubscribe;
  }, [userProfile]);

  useEffect(() => {
    if (userProfile?.role !== 'admin' || !auth.currentUser) {
      setSaleCostSnapshots({});
      return;
    }
    const tenantOwnerId = userProfile.ownerId || userProfile.uid;
    return onSnapshot(
      query(collection(db, 'sale_costs'), where('ownerId', '==', tenantOwnerId)),
      snapshot => setSaleCostSnapshots(Object.fromEntries(snapshot.docs.map(item => [
        item.id,
        (item.data().items || []) as Array<{ productId: string; quantity: number; unitBuyPrice: number | null }>,
      ]))),
      error => handleFirestoreError(error, OperationType.LIST, 'sale_costs'),
    );
  }, [userProfile]);

  const saleHasLoss = (sale: Sale) => {
    if (userProfile?.role !== 'admin') return false;
    const costs = saleCostSnapshots[sale.id] || [];
    const profit = computeSaleProfit(sale, costs).profit;
    return (profit !== null && profit < 0) || costs.some(cost => {
      const item = sale.items.find(line => line.productId === cost.productId);
      return item && typeof cost.unitBuyPrice === 'number' && item.price < cost.unitBuyPrice;
    });
  };

  // Charge les produits pour permettre la recherche d'historique par code produit (code-barres / ID / nom)
  useEffect(() => {
    if (!auth.currentUser || !userProfile) return;
    const tenantOwnerId = userProfile.ownerId || userProfile.uid;
    const q = query(collection(db, 'products'), where('ownerId', '==', tenantOwnerId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setProducts(snapshot.docs.map(d => {
        const data = d.data();
        delete data.buyPrice;
        return { id: d.id, ...data } as Product;
      }));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'products');
    });
    return unsubscribe;
  }, [userProfile]);

  // Résout le code saisi (code-barres, ID ou nom) vers les identifiants de produits correspondants
  const matchedProductIds = (() => {
    const code = productCode.trim().toLowerCase();
    if (!code) return null;
    const ids = new Set<string>();
    products.forEach(p => {
      if (
        (p.barcode && p.barcode.toLowerCase() === code) ||
        p.id.toLowerCase() === code ||
        p.name.toLowerCase().includes(code)
      ) {
        ids.add(p.id);
      }
    });
    return ids;
  })();

  const filteredSales = sales.filter(s => {
    const matchSearch =
      s.clientName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.id.toLowerCase().includes(searchTerm.toLowerCase());
    const matchFilter =
      filterStatus === 'all' ||
      (filterStatus === 'paid' && s.debt === 0) ||
      (filterStatus === 'partial' && s.debt > 0);
    // Filtre par code produit : ne garde que les ventes contenant l'article recherché
    const code = productCode.trim().toLowerCase();
    const matchProduct =
      !code ||
      (s.items || []).some(item =>
        (matchedProductIds && matchedProductIds.has(item.productId)) ||
        item.productId?.toLowerCase() === code ||
        item.name?.toLowerCase().includes(code)
      );
    return matchSearch && matchFilter && matchProduct;
  });

  // Stats
  const totalRevenue = sales.reduce((sum, s) => sum + s.paid, 0);
  const totalDebt = sales.reduce((sum, s) => sum + s.debt, 0);
  const paidCount = sales.filter(s => s.debt === 0).length;

  return (
    <div className="min-w-0 space-y-6 font-sans">
      <PageHeader
        title={t('title')}
        description={t('transactionCount', { count: sales.length })}
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-3">
        {/* Chiffre encaissé */}
        <Card className="flex min-h-36 flex-col p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-ds-muted">{t('collected')}</p>
              <div className="flex h-9 w-9 items-center justify-center rounded-ds-md bg-ds-surface-2">
                <TrendingUp className="w-4 h-4 text-ds-muted" />
              </div>
            </div>
            <p className="mt-auto text-xl font-bold text-ds-text"><bdi dir="ltr">{formatNumber(totalRevenue, { minimumFractionDigits: 3, maximumFractionDigits: 3 })} <span className="text-sm font-semibold text-ds-muted">DT</span></bdi></p>
        </Card>

        {/* Ventes payées */}
        <Card className="flex min-h-36 flex-col p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-ds-muted">{t('paid')}</p>
            <div className="flex h-9 w-9 items-center justify-center rounded-ds-md bg-ds-success-soft">
              <CheckCircle2 className="w-4 h-4 text-ds-success" />
            </div>
          </div>
          <p className="mt-auto text-xl font-bold text-ds-text"><bdi dir="ltr">{paidCount}<span className="ms-1 text-sm font-semibold text-ds-muted">/ {sales.length}</span></bdi></p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ds-surface-2">
            <div
              className="h-full rounded-full bg-ds-success transition-all duration-700"
              style={{ width: sales.length ? `${(paidCount / sales.length) * 100}%` : '0%' }}
            />
          </div>
        </Card>

        {/* Dettes */}
        <Card className="flex min-h-36 flex-col p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-ds-muted">{t('debts')}</p>
            <div className={cn(
              "flex h-9 w-9 items-center justify-center rounded-ds-md",
              totalDebt > 0 ? "bg-ds-warning-soft" : "bg-ds-surface-2",
            )}>
              <AlertCircle className={totalDebt > 0 ? "w-4 h-4 text-ds-warning" : "w-4 h-4 text-ds-muted"} />
            </div>
          </div>
          <p className="mt-auto text-xl font-bold text-ds-text"><bdi dir="ltr">{formatNumber(totalDebt, { minimumFractionDigits: 3, maximumFractionDigits: 3 })} <span className="text-sm font-semibold text-ds-muted">DT</span></bdi></p>
          <p className={cn("mt-1 text-xs font-medium", totalDebt > 0 ? "text-ds-warning" : "text-ds-muted")}>{t('salesPending', { count: sales.filter(s => s.debt > 0).length })}</p>
        </Card>
      </div>

      {/* Recherche par code produit — affiche l'historique des ventes d'un article */}
      <Card className="p-5">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
          <div className="w-full sm:max-w-md">
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ds-text">
              <Package className="w-3.5 h-3.5" />
              {t('productHistory')}
            </label>
            <div className="relative">
              <Package className="absolute start-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ds-muted" />
              <Input
                type="text"
                name="product-code-search"
                placeholder={t('productSearch')}
                value={productCode}
                onChange={(e) => setProductCode(e.target.value)}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                className="ps-10 pe-10"
              />
              {productCode && (
                <button
                  onClick={() => setProductCode('')}
                  className="absolute end-3 top-1/2 -translate-y-1/2 rounded-ds-sm p-2 text-ds-muted hover:bg-ds-surface-2 hover:text-ds-text"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
          {productCode.trim() && (
            <Badge variant="info" className="shrink-0">
              {t('foundSales', { count: filteredSales.length })}
            </Badge>
          )}
        </div>
      </Card>

      {/* Table Card */}
      <Card className="overflow-hidden p-0">
        {/* Toolbar */}
        <div className="flex flex-col items-start justify-between gap-3 border-b border-ds-border p-4 sm:flex-row sm:items-center sm:p-5">
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute start-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ds-muted" />
            <Input
              type="text"
              name="sales-search"
              placeholder={t('clientSearch')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              className="ps-10 pe-4"
            />
          </div>

          {/* Filter pills */}
          <div className="flex items-center gap-2">
            {(['all', 'paid', 'partial'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilterStatus(f)}
                className={cn(
                  "min-h-ds-touch-target rounded-ds-md px-3 text-xs font-semibold uppercase tracking-wide transition-all",
                  filterStatus === f
                    ? "bg-ds-brand text-ds-brand-contrast"
                    : "bg-ds-surface-2 text-ds-muted hover:bg-ds-border"
                )}
              >
                {f === 'all' ? t('filterAll') : f === 'paid' ? t('filterPaid') : t('filterPartial')}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="responsive-card-table w-full text-start">
            <thead>
                <tr className="border-b border-ds-border bg-ds-surface-2">
                  <th className="px-6 py-3.5 text-[10px] font-black uppercase tracking-[0.15em] text-ds-muted">{t('date')}</th>
                  <th className="px-6 py-3.5 text-[10px] font-black uppercase tracking-[0.15em] text-ds-muted">{t('client')}</th>
                  <th className="px-6 py-3.5 text-[10px] font-black uppercase tracking-[0.15em] text-ds-muted">{t('total')}</th>
                  <th className="px-6 py-3.5 text-[10px] font-black uppercase tracking-[0.15em] text-ds-muted">{t('status')}</th>
                  <th className="px-6 py-3.5 text-end text-[10px] font-black uppercase tracking-[0.15em] text-ds-muted">{t('action')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ds-border">
              {loading ? (
                // Skeleton rows
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 5 }).map((_, j) => (
                      <td key={j} className="px-6 py-4">
                        <div className="h-3 animate-pulse rounded-full bg-ds-surface-2" style={{ width: `${60 + Math.random() * 30}%` }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filteredSales.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10">
                  <EmptyState
                    icon={<Receipt className="h-10 w-10" />}
                    title={t('noSales')}
                    description={t('trySearch')}
                  />
                  </td>
                </tr>
              ) : (
                filteredSales.map((sale) => (
                  <tr
                    key={sale.id}
                    className="group cursor-pointer transition-colors hover:bg-ds-brand-soft/50"
                    onClick={() => setSelectedSale(sale)}
                  >
                    <td data-label={t('date')} className="px-6 py-4">
                      <div className="text-sm font-bold text-ds-text">
                        {sale.date?.toDate ? formatDateTime(sale.date.toDate(), { dateStyle: 'medium' }) : '—'}
                      </div>
                      <div className="flex items-center gap-1 mt-0.5">
                        <Clock className="w-3 h-3 text-ds-muted" />
                        <span className="text-[10px] font-mono text-ds-muted">
                          {sale.date?.toDate ? formatDateTime(sale.date.toDate(), { hour: '2-digit', minute: '2-digit' }) : '—'}
                        </span>
                      </div>
                    </td>
                    <td data-label={t('client')} className="px-6 py-4">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-ds-sm bg-ds-brand-soft text-[10px] font-black text-ds-brand">
                          {sale.clientName?.[0]?.toUpperCase() || '?'}
                        </div>
                        <span className="text-sm font-bold text-ds-text">{sale.clientName || t('unknownClient')}</span>
                        {saleHasLoss(sale) && (
                          <Badge variant="danger" className="min-h-0 px-2 py-0.5 text-[9px] uppercase">{t('soldAtLoss')}</Badge>
                        )}
                      </div>
                    </td>
                    <td data-label={t('total')} className="px-6 py-4">
                      <span className="text-sm font-black text-ds-text font-mono">{formatNumber(sale.total, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}</span>
                      <span className="ms-1 text-[10px] font-bold text-ds-muted">DT</span>
                    </td>
                    <td data-label={t('status')} className="px-6 py-4">
                      {sale.debt > 0 ? (
                      <Badge variant="warning">-{formatNumber(sale.debt, { minimumFractionDigits: 3, maximumFractionDigits: 3 })} DT</Badge>
                      ) : (
                      <Badge variant="success">{t('paidLabel')}</Badge>
                      )}
                    </td>
                    <td data-label={t('actions')} className="px-6 py-4 text-end">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setSelectedSale(sale); }}
                          variant="secondary"
                          size="sm"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          {t('view')}
                        </Button>

                        <Button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const code = userProfile?.securityCode;
                            if (code && code.length === 4) {
                              setPendingDeleteSale(sale);
                              setSecurityCode('');
                              setSecurityError(false);
                              setShowSecurityInput(false);
                              setShowSecurityModal(true);
                            } else {
                              setSaleToDelete(sale);
                            }
                          }}
                          variant="danger"
                          size="sm"
                          title={t('deleteSaleTitle')}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          {t('delete')}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer count */}
        {!loading && filteredSales.length > 0 && (
          <div className="border-t border-ds-border bg-ds-surface-2 px-6 py-3">
            <p className="text-xs font-medium text-ds-muted">{t('resultCount', { count: filteredSales.length })}</p>
          </div>
        )}
      </Card>

      {/* Sale Detail Modal */}
      {selectedSale && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div
            className="bg-ds-surface rounded-ds-lg shadow-ds-md w-full max-w-2xl overflow-hidden border border-ds-border flex flex-col max-h-[90vh]"
            style={{ animation: 'modalIn 0.2s cubic-bezier(0.34,1.56,0.64,1)' }}
          >
            {/* Modal Header */}
            <div className="px-5 py-4 sm:px-8 sm:py-5 border-b border-ds-border flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-ds-md bg-ds-brand flex items-center justify-center text-ds-brand-contrast">
                  <Receipt className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-black text-ds-text leading-none">{t('saleDetails')}</h2>
                  <p className="mt-0.5 text-[10px] font-mono uppercase tracking-wider text-ds-muted">{selectedSale.id.slice(0, 12)}…</p>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelectedSale(null)} aria-label={t('close')}>
                <X className="w-5 h-5" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-8 space-y-6">
              {/* Client + Date */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="rounded-ds-md border border-ds-border bg-ds-surface-2 p-4">
                  <p className="mb-2 text-[10px] font-black uppercase tracking-[0.15em] text-ds-muted">{t('client')}</p>
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-ds-md bg-ds-brand-soft text-xs font-black text-ds-brand">
                      {selectedSale.clientName?.[0]?.toUpperCase() || '?'}
                    </div>
                    <span className="text-sm font-black text-ds-text">{selectedSale.clientName}</span>
                  </div>
                </div>
                <div className="rounded-ds-md border border-ds-border bg-ds-surface-2 p-4">
                  <p className="mb-2 text-[10px] font-black uppercase tracking-[0.15em] text-ds-muted">{t('dateTime')}</p>
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 shrink-0 text-ds-brand" />
                    <span className="text-sm font-bold text-ds-text">
                      {selectedSale.date?.toDate ? formatDateTime(selectedSale.date.toDate(), { dateStyle: 'long', timeStyle: 'short' }) : t('unknown')}
                    </span>
                  </div>
                </div>
              </div>

              {/* Items Table */}
              <div>
                <p className="mb-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.15em] text-ds-muted">
                  <ShoppingBag className="w-3.5 h-3.5" /> {t('soldItems')}
                </p>
                <div className="overflow-x-auto rounded-ds-md border border-ds-border">
                  <table className="w-full min-w-[420px] text-start">
                    <thead>
                      <tr className="border-b border-ds-border bg-ds-surface-2">
                        <th className="px-5 py-3 text-[10px] font-black uppercase tracking-wider text-ds-muted">{t('product')}</th>
                        <th className="px-5 py-3 text-center text-[10px] font-black uppercase tracking-wider text-ds-muted">{t('quantity')}</th>
                        <th className="px-5 py-3 text-end text-[10px] font-black uppercase tracking-wider text-ds-muted">{t('unitPrice')}</th>
                        <th className="px-5 py-3 text-end text-[10px] font-black uppercase tracking-wider text-ds-muted">{t('total')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ds-border">
                      {selectedSale.items.map((item, idx) => (
                        <tr key={idx} className="transition-colors hover:bg-ds-surface-2">
                          <td className="px-5 py-3 text-sm font-bold text-ds-text">
                            {item.name}
                            {formatProductDetails(item.attributes, item.serialNumber) && <div className="mt-1 text-[10px] font-normal text-ds-muted">{formatProductDetails(item.attributes, item.serialNumber)}</div>}
                          </td>
                          <td className="px-5 py-3 text-center">
                            <Badge variant="info" className="min-h-0 px-2 py-1">{item.quantity}</Badge>
                          </td>
                          <td className="px-5 py-3 text-end text-xs font-mono text-ds-muted">{formatNumber(item.price, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}</td>
                          <td className="px-5 py-3 text-end text-sm font-black text-ds-brand font-mono">{formatNumber(item.total, { minimumFractionDigits: 3, maximumFractionDigits: 3 })} DT</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Summary */}
              <Card className="space-y-3 bg-ds-surface-2 p-5">
                <div className="flex justify-between items-center text-sm text-ds-muted">
                  <span className="font-bold uppercase tracking-wider text-xs">{t('saleTotal')}</span>
                  <span className="font-mono">{formatNumber(selectedSale.total, { minimumFractionDigits: 3, maximumFractionDigits: 3 })} DT</span>
                </div>
                <div className="flex justify-between items-center border-t border-ds-border pt-3">
                  <span className="font-black uppercase tracking-wider text-xs">{t('amountPaid')}</span>
                  <span className="text-xl font-black font-mono text-ds-success">{formatNumber(selectedSale.paid, { minimumFractionDigits: 3, maximumFractionDigits: 3 })} DT</span>
                </div>
                {selectedSale.debt > 0 && (
                  <div className="flex justify-between items-center border-t border-ds-border pt-3">
                    <span className="text-xs font-black uppercase tracking-wider text-ds-warning">{t('remaining')}</span>
                    <span className="text-xl font-black font-mono text-ds-warning">{formatNumber(selectedSale.debt, { minimumFractionDigits: 3, maximumFractionDigits: 3 })} DT</span>
                  </div>
                )}
              </Card>
            </div>

            {/* Modal Footer */}
            <div className="flex gap-3 border-t border-ds-border bg-ds-surface-2 p-4 sm:p-6">
              <Button
                onClick={() => downloadPDF(selectedSale)}
                className="flex-1"
              >
                <Download className="w-4 h-4" />
                {t('downloadPdf')}
              </Button>
              <Button type="button" variant="secondary"
                onClick={() => window.print()}
                className="flex-1"
              >
                <Printer className="w-4 h-4" />
                {t('print')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Security Code Modal */}
      {showSecurityModal && pendingDeleteSale && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <Card className="w-full max-w-sm overflow-hidden p-0 shadow-ds-md">
            <div className="flex items-center justify-between border-b border-ds-border bg-ds-danger-soft px-6 py-4">
              <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wider text-ds-text">
                <Shield className="w-4 h-4 text-ds-danger" />
                {t('securityRequired')}
              </h3>
              <Button variant="ghost" size="sm" onClick={() => { setShowSecurityModal(false); setPendingDeleteSale(null); }} aria-label={t('close')}>
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-ds-muted">
                {t('securityDescription')}
              </p>
              <div className="relative">
                <Shield className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ds-muted" />
                <Input
                  type={showSecurityInput ? 'text' : 'password'}
                  name="sale-security-code"
                  autoComplete="one-time-code"
                  maxLength={4}
                  inputMode="numeric"
                  autoFocus
                  value={securityCode}
                  onChange={(e) => {
                    const val = e.target.value.replace(/[^0-9]/g, '').slice(0, 4);
                    setSecurityCode(val);
                    setSecurityError(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && securityCode.length === 4) {
                      if (securityCode === userProfile?.securityCode) {
                        setShowSecurityModal(false);
                        setSaleToDelete(pendingDeleteSale);
                        setPendingDeleteSale(null);
                      } else {
                        setSecurityError(true);
                        setSecurityCode('');
                      }
                    }
                  }}
                  placeholder="● ● ● ●"
                  className={`ps-9 pe-10 text-center text-xl font-mono font-black tracking-[0.5em] ${
                    securityError
                      ? 'border-ds-danger bg-ds-danger-soft text-ds-danger'
                      : ''
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowSecurityInput(!showSecurityInput)}
                  className="absolute end-3 top-1/2 -translate-y-1/2 rounded-ds-sm p-2 text-ds-muted hover:bg-ds-surface-2 hover:text-ds-text"
                >
                  {showSecurityInput ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" /> }
                </button>
              </div>
              {securityError && (
                <p className="flex items-center gap-1.5 text-sm font-semibold text-ds-danger">
                  <AlertCircle className="w-3.5 h-3.5" />
                  {t('incorrectCode')}
                </p>
              )}
              <div className="flex gap-3 pt-1">
                <Button
                  onClick={() => { setShowSecurityModal(false); setPendingDeleteSale(null); setSecurityCode(''); setSecurityError(false); }}
                  variant="secondary"
                  className="flex-1"
                >
                  {t('cancel')}
                </Button>
                <Button
                  onClick={() => {
                    if (securityCode === userProfile?.securityCode) {
                      setShowSecurityModal(false);
                      setSaleToDelete(pendingDeleteSale);
                      setPendingDeleteSale(null);
                      setSecurityCode('');
                      setSecurityError(false);
                    } else {
                      setSecurityError(true);
                      setSecurityCode('');
                    }
                  }}
                  disabled={securityCode.length !== 4}
                  className="flex-1"
                >
                  {t('confirm')}
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Sale Delete Confirmation Modal */}
      {saleToDelete && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <Card className="w-full max-w-sm space-y-4 p-6 shadow-ds-md">
            <div className="flex items-start gap-3">
              <div className="rounded-ds-md bg-ds-danger-soft p-2.5 text-ds-danger">
                <AlertCircle className="w-6 h-6 animate-pulse" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-black uppercase tracking-wider text-ds-text">{t('deleteSaleQuestion')}</h3>
                <p className="text-sm leading-relaxed text-ds-muted">
                  {t('deleteSaleConfirm', { id: saleToDelete.id.slice(0, 8), amount: formatNumber(saleToDelete.total, { minimumFractionDigits: 3, maximumFractionDigits: 3 }) })}
                </p>
                <p className="mt-1 rounded-ds-sm border border-ds-danger/20 bg-ds-danger-soft p-2 text-xs font-semibold leading-normal text-ds-danger">
                  {t('deleteSaleWarning')}
                </p>
              </div>
            </div>
            
            <div className="flex gap-3 justify-end pt-2">
              <Button
                type="button"
                variant="secondary"
                disabled={deleting}
                onClick={() => setSaleToDelete(null)}
              >
                {t('cancel')}
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={deleting}
                onClick={handleDeleteConfirm}
              >
                {deleting ? (
                  <>
                    <span>{t('deleting')}</span>
                  </>
                ) : (
                  <span>{t('confirm')}</span>
                )}
              </Button>
            </div>
          </Card>
        </div>
      )}

      <style>{`
        @keyframes modalIn {
          from { opacity: 0; transform: scale(0.95) translateY(8px); }
          to   { opacity: 1; transform: scale(1)    translateY(0); }
        }
      `}</style>
    </div>
  );
}
