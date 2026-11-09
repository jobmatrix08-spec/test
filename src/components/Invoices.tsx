import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { collection, onSnapshot, query, orderBy, limit, doc, runTransaction, serverTimestamp, where, Timestamp, setDoc } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { db, auth } from '../firebase';
import { apiFetch } from '../lib/api';
import { computeTotals, normalizeFinancialSettings } from '../lib/financial';
import { auditDate, auditName, getAuditActor, logAudit } from '../lib/audit';
import { Invoice, Product, Client, SaleItem, StoreSettings, UserProfile } from '../types';
import { formatProductDetails } from '../config/productAttributes';
import { handleFirestoreError, OperationType } from '../App';
import { Search, FileText, Eye, X, Printer, Download, User, Calendar, ShoppingBag, Plus, Trash2, Minus, AlertCircle, CheckCircle2, Paperclip, Wallet, Ban } from 'lucide-react';
import { slugifyAppName } from '../lib/brand';
import { useBrand } from './BrandProvider';
import { cn } from '../lib/utils';
import { PrintableTicket } from './PrintableTicket';
import { addCashSessionTotals, requireOpenCashSession, useCashSession } from '../lib/cashSessions';
import { calculatePurchaseTotals, getPurchaseCancellationStock, getPurchasePaymentBalance, getPurchaseReceiptStock } from '../lib/purchaseAccounting';
import { Badge, Button, Card, EmptyState, Input, PageHeader, Select } from './ui';
import { useTranslation } from 'react-i18next';
import { formatDateTime, formatDocumentDate, getDateLocale } from '../i18n/format';

interface InvoicesProps {
  userProfile: UserProfile | null;
}

interface PurchaseInvoiceRecord {
  id: string;
  number?: string;
  invoiceNumber?: string;
  date?: any;
  supplierName?: string;
  supplierId?: string;
  total?: number;
  totalMilli?: number;
  paidMilli?: number;
  debtMilli?: number;
  status?: 'received' | 'cancelled';
  note?: string;
  attachment?: PurchaseAttachment;
  items?: PurchaseLine[];
  sessionId?: string;
  cancelledAt?: any;
  cancelledBy?: string;
  cancellationReason?: string;
}

interface PurchaseAttachment {
  url?: string;
  dataUrl?: string;
  fileName: string;
}

interface PurchaseLine {
  itemId: string;
  itemCollection: 'products' | 'parts';
  nameSnapshot: string;
  quantity: number;
  unitCostMilli: number;
}

interface SupplierRecord {
  id: string;
  name: string;
  phone?: string;
  ownerId: string;
}

interface SupplierPaymentRecord {
  id: string;
  amountMilli: number;
  type: string;
  purchaseNumber?: string;
  createdAt?: any;
  createdBy?: string;
}

interface PurchaseCatalogItem {
  id: string;
  name: string;
  collection: 'products' | 'parts';
  stock: number;
  inventoryType?: string;
}

async function compressPurchaseImage(file: File, translate: (key: string) => string): Promise<PurchaseAttachment> {
  if (!file.type.startsWith('image/')) throw new Error(translate('invalidImage'));
  const image = await createImageBitmap(file);
  let scale = Math.min(1, 1600 / Math.max(image.width, image.height));
  let quality = 0.78;
  let blob: Blob | null = null;
  const canvas = document.createElement('canvas');

  for (let attempt = 0; attempt < 8; attempt += 1) {
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error(translate('compressFailed'));
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (blob && blob.size < 350 * 1024) break;
    quality = Math.max(0.35, quality - 0.08);
    scale *= 0.82;
  }
  image.close();
  if (!blob || blob.size >= 350 * 1024) throw new Error(translate('imageTooLarge'));
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error(translate('readImageFailed')));
    reader.onerror = () => reject(new Error(translate('readImageFailed')));
    reader.readAsDataURL(blob);
  });
  if (dataUrl.length >= 500 * 1024) throw new Error(translate('imageDataTooLarge'));
  return { dataUrl, fileName: file.name };
}

function toInvoiceDate(value: unknown): Date | null {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate();
  }
  const parsed = value instanceof Date ? value : value ? new Date(String(value)) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

export default function Invoices({ userProfile }: InvoicesProps) {
  const { t: invoiceT } = useTranslation('invoices');
  const brand = useBrand();
  const navigate = useNavigate();
  const { session: cashSession, loading: cashSessionLoading } = useCashSession(userProfile);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [purchaseInvoices, setPurchaseInvoices] = useState<PurchaseInvoiceRecord[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>([]);
  const [purchaseCatalog, setPurchaseCatalog] = useState<PurchaseCatalogItem[]>([]);
  const [storeSettings, setStoreSettings] = useState<StoreSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<'sales' | 'purchases'>('sales');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [isNewInvoiceModalOpen, setIsNewInvoiceModalOpen] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [isPurchaseModalOpen, setIsPurchaseModalOpen] = useState(false);
  const [purchaseNumber, setPurchaseNumber] = useState(`ACH-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`);
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0, 10));
  const [purchaseSupplierId, setPurchaseSupplierId] = useState('');
  const [quickSupplierName, setQuickSupplierName] = useState('');
  const [purchaseItemId, setPurchaseItemId] = useState('');
  const [purchaseItemQuantity, setPurchaseItemQuantity] = useState('1');
  const [purchaseItemCost, setPurchaseItemCost] = useState('');
  const [purchaseLines, setPurchaseLines] = useState<PurchaseLine[]>([]);
  const [purchasePaidAmount, setPurchasePaidAmount] = useState('0');
  const [purchaseNote, setPurchaseNote] = useState('');
  const [purchaseAttachment, setPurchaseAttachment] = useState<PurchaseAttachment | null>(null);
  const [purchaseAttachmentUrl, setPurchaseAttachmentUrl] = useState('');
  const [purchaseError, setPurchaseError] = useState('');
  const [purchaseSuccess, setPurchaseSuccess] = useState('');
  const [purchaseSaving, setPurchaseSaving] = useState(false);
  const [purchaseFileLoading, setPurchaseFileLoading] = useState(false);
  const [selectedPurchase, setSelectedPurchase] = useState<PurchaseInvoiceRecord | null>(null);
  const [supplierPayments, setSupplierPayments] = useState<SupplierPaymentRecord[]>([]);
  const [supplierPaymentAmount, setSupplierPaymentAmount] = useState('');
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [showPurchaseCancelConfirm, setShowPurchaseCancelConfirm] = useState(false);

  const ownerId = (userProfile?.role === 'admin' ? userProfile?.uid : userProfile?.ownerId) || userProfile?.uid || auth.currentUser?.uid;
  const isStoreAdmin = userProfile?.role === 'admin' && (userProfile.ownerId || userProfile.uid) === userProfile.uid;
  
  const handlePrint = () => {
    if (!selectedInvoice) {
      console.warn('Aucune facture sélectionnée pour l\'impression.');
      return;
    }
    // Small delay to ensure the ticket is rendered in the DOM
    setTimeout(() => {
      try {
        window.print();
      } catch (e) {
        console.error('Erreur lors de l\'impression:', e);
        alert(invoiceT('ui.errors.printFailed'));
      }
    }, 500);
  };
  
  // New Invoice Form State
  const [clients, setClients] = useState<Client[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [cart, setCart] = useState<SaleItem[]>([]);
  const [paidAmount, setPaidAmount] = useState<number>(0);
  const [paidAmountInput, setPaidAmountInput] = useState('0');
  const [isPaidFocused, setIsPaidFocused] = useState(false);

  useEffect(() => {
    if (!isPaidFocused) {
      setPaidAmountInput(paidAmount === 0 ? '' : paidAmount.toFixed(3));
    }
  }, [paidAmount, isPaidFocused]);

  const [isProcessing, setIsProcessing] = useState(false);
  const [saleSuccess, setSaleSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.currentUser || !ownerId) return;
    const q = query(collection(db, 'invoices'), where('ownerId', '==', ownerId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const invs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Invoice));
      invs.sort((a, b) => {
        const timeA = a.date?.seconds || 0;
        const timeB = b.date?.seconds || 0;
        return timeB - timeA;
      });
      setInvoices(invs);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'invoices');
    });

    const unsubscribeSettings = onSnapshot(doc(db, 'settings', ownerId), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data() as StoreSettings;
        setStoreSettings({ ...data, ...normalizeFinancialSettings(data) });
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `settings/${ownerId}`);
    });
    const unsubscribePurchases = isStoreAdmin
      ? onSnapshot(query(collection(db, 'purchases'), where('ownerId', '==', ownerId)), snapshot => {
        const purchases = snapshot.docs.map(item => ({ id: item.id, ...item.data() } as PurchaseInvoiceRecord));
        purchases.sort((a, b) => (toInvoiceDate(b.date)?.getTime() || 0) - (toInvoiceDate(a.date)?.getTime() || 0));
        setPurchaseInvoices(purchases);
        setSelectedPurchase(current => current ? (purchases.find(item => item.id === current.id) || current) : current);
      }, error => handleFirestoreError(error, OperationType.LIST, 'purchases'))
      : () => setPurchaseInvoices([]);

    return () => {
      unsubscribe();
      unsubscribeSettings();
      unsubscribePurchases();
    };
  }, [ownerId, isStoreAdmin]);

  useEffect(() => {
    if (!isStoreAdmin || !ownerId || !auth.currentUser) {
      setSuppliers([]);
      return;
    }
    return onSnapshot(query(collection(db, 'suppliers'), where('ownerId', '==', ownerId)), snapshot => {
      const records = snapshot.docs.map(item => ({ id: item.id, ...item.data() } as SupplierRecord));
      records.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
      setSuppliers(records);
    }, error => handleFirestoreError(error, OperationType.LIST, 'suppliers'));
  }, [ownerId, isStoreAdmin]);

  useEffect(() => {
    if (!selectedPurchase?.supplierId || !ownerId || !isStoreAdmin) {
      setSupplierPayments([]);
      return;
    }
    return onSnapshot(
      query(
        collection(db, 'supplier_debts', selectedPurchase.supplierId, 'payments'),
        where('ownerId', '==', ownerId),
      ),
      snapshot => {
        const payments = snapshot.docs.map(item => ({ id: item.id, ...item.data() } as SupplierPaymentRecord));
        payments.sort((a, b) => (toInvoiceDate(b.createdAt)?.getTime() || 0) - (toInvoiceDate(a.createdAt)?.getTime() || 0));
        setSupplierPayments(payments.filter(payment => payment.purchaseNumber === selectedPurchase.number));
      },
      error => handleFirestoreError(error, OperationType.LIST, 'supplier_debts/payments'),
    );
  }, [selectedPurchase?.supplierId, selectedPurchase?.number, ownerId, isStoreAdmin]);

  useEffect(() => {
    if (isNewInvoiceModalOpen) {
      const unsubClients = onSnapshot(query(collection(db, 'clients'), where('ownerId', '==', ownerId)), (snap) => {
        const cls = snap.docs.map(d => ({ id: d.id, ...d.data() } as Client));
        cls.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        setClients(cls);
      }, (err) => {
        handleFirestoreError(err, OperationType.LIST, 'clients');
      });
      const unsubProducts = onSnapshot(query(collection(db, 'products'), where('ownerId', '==', ownerId)), (snap) => {
        const prods = snap.docs.map(d => {
          const data = d.data();
          delete data.buyPrice;
          return { id: d.id, ...data, buyPrice: 0 } as Product;
        });
        prods.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        setProducts(prods);
      }, (err) => {
        handleFirestoreError(err, OperationType.LIST, 'products');
      });
      return () => {
        unsubClients();
        unsubProducts();
      };
    }
  }, [isNewInvoiceModalOpen, ownerId]);

  useEffect(() => {
    if (!isPurchaseModalOpen || !isStoreAdmin || !ownerId) return;
    const unsubscribeProducts = onSnapshot(
      query(collection(db, 'products'), where('ownerId', '==', ownerId)),
      snapshot => setPurchaseCatalog(current => [
        ...current.filter(item => item.collection !== 'products'),
        ...snapshot.docs
          .filter(item => item.data().inventoryType !== 'service')
          .map(item => ({ id: item.id, name: String(item.data().name || 'Article'), collection: 'products' as const, stock: Number(item.data().stock) || 0 })),
      ]),
      error => handleFirestoreError(error, OperationType.LIST, 'products'),
    );
    const unsubscribeParts = onSnapshot(
      query(collection(db, 'parts'), where('ownerId', '==', ownerId)),
      snapshot => setPurchaseCatalog(current => [
        ...current.filter(item => item.collection !== 'parts'),
        ...snapshot.docs.map(item => ({ id: item.id, name: String(item.data().name || invoiceT('ui.part')), collection: 'parts' as const, stock: Number(item.data().stock) || 0 })),
      ]),
      error => handleFirestoreError(error, OperationType.LIST, 'parts'),
    );
    return () => {
      unsubscribeProducts();
      unsubscribeParts();
    };
  }, [isPurchaseModalOpen, isStoreAdmin, ownerId]);

  const addToCart = (product: Product) => {
    setCart(prev => {
      const existing = prev.find(item => item.productId === product.id);
      if (existing) {
        if (existing.quantity >= product.stock) return prev;
        return prev.map(item => 
          item.productId === product.id 
            ? { ...item, quantity: item.quantity + 1, total: (item.quantity + 1) * item.price }
            : item
        );
      }
      return [...prev, {
        productId: product.id,
        name: product.name,
        quantity: 1,
        price: product.sellPrice,
        total: product.sellPrice,
        attributes: product.attributes,
        serialNumber: product.serialNumber,
      }];
    });
  };

  const updateQuantity = (productId: string, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.productId === productId) {
        const product = products.find(p => p.id === productId);
        const newQty = Math.max(1, item.quantity + delta);
        if (product && newQty > product.stock) return item;
        return { ...item, quantity: newQty, total: newQty * item.price };
      }
      return item;
    }));
  };

  const removeFromCart = (productId: string) => {
    setCart(prev => prev.filter(item => item.productId !== productId));
  };

  const financialTotals = useMemo(
    () => computeTotals(cart, 0, storeSettings),
    [cart, storeSettings?.tvaEnabled, storeSettings?.tva],
  );
  const { subtotal, tva: tvaAmount, total: cartTotal } = financialTotals;

  useEffect(() => {
    setPaidAmount(cartTotal);
  }, [selectedClient, cartTotal]);

  const remainingDebt = Math.round(Math.max(0, cartTotal - paidAmount) * 1000) / 1000;
  const purchaseTotalMilli = purchaseLines.reduce((sum, line) => sum + line.quantity * line.unitCostMilli, 0);
  const purchasePaidMilli = Math.round((Number(purchasePaidAmount.replace(',', '.')) || 0) * 1000);
  const purchaseDebtMilli = purchaseTotalMilli - purchasePaidMilli;

  const addPurchaseLine = () => {
    const item = purchaseCatalog.find(candidate => `${candidate.collection}:${candidate.id}` === purchaseItemId);
    const quantity = Number(purchaseItemQuantity);
    const unitCost = Number(purchaseItemCost.replace(',', '.'));
    if (!item || !Number.isInteger(quantity) || quantity <= 0 || !Number.isFinite(unitCost) || unitCost < 0) {
      setPurchaseError(invoiceT('ui.errors.invalidPurchaseLine'));
      return;
    }
    if (purchaseLines.some(line => line.itemId === item.id && line.itemCollection === item.collection)) {
      setPurchaseError(invoiceT('ui.errors.duplicatePurchaseLine'));
      return;
    }
    setPurchaseLines(current => [...current, {
      itemId: item.id,
      itemCollection: item.collection,
      nameSnapshot: item.name,
      quantity,
      unitCostMilli: Math.round(unitCost * 1000),
    }]);
    setPurchaseItemId('');
    setPurchaseItemQuantity('1');
    setPurchaseItemCost('');
    setPurchaseError('');
  };

  const filteredProducts = useMemo(() => 
    products.filter(p => 
      p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
      (p.barcode && p.barcode.toLowerCase().includes(productSearch.toLowerCase()))
    ), [products, productSearch]
  );

  const validateSale = async () => {
    if (cart.length === 0) return;
    if (!cashSession) {
      setError(cashSessionLoading
        ? invoiceT('ui.cashChecking')
        : invoiceT('ui.errors.cashRequiredInvoice'));
      return;
    }
    setIsProcessing(true);
    setError(null);

    // Règle de paiement selon le type de client
    if (!selectedClient) {
      if (Math.abs(paidAmount - cartTotal) > 0.001) {
        setError(invoiceT('ui.errors.walkInPayment', { amount: cartTotal.toFixed(3), currency: storeSettings?.currency || 'DT' }));
        setIsProcessing(false);
        return;
      }
    } else {
      if (paidAmount > cartTotal + 0.001) {
        setError(invoiceT('ui.errors.paidExceedsTotal', { amount: cartTotal.toFixed(3), currency: storeSettings?.currency || 'DT' }));
        setIsProcessing(false);
        return;
      }
    }

    try {
      const saleRef = doc(collection(db, 'sales'));
      const invoiceRef = doc(collection(db, 'invoices'));
      const actor = getAuditActor(userProfile, userProfile?.uid || auth.currentUser?.uid || ownerId);
      await runTransaction(db, async (transaction) => {
        
        // 1. ALL READS FIRST
        const counterRef = doc(db, 'counters', `invoices_${ownerId}`);
        const counterSnap = await transaction.get(counterRef);
        
        const productSnaps = await Promise.all(
          cart.map(item => transaction.get(doc(db, 'products', item.productId)))
        );

        let clientSnap = null;
        if (selectedClient && remainingDebt > 0) {
          clientSnap = await transaction.get(doc(db, 'clients', selectedClient.id));
        }
        const activeCashSession = await requireOpenCashSession(
          transaction,
          userProfile?.uid || auth.currentUser?.uid || '',
          ownerId || '',
        );

        // 2. LOGIC & VALIDATION
        let nextNum = 1;
        if (counterSnap.exists()) {
          nextNum = (counterSnap.data().lastNum || 0) + 1;
        }
        
        const year = new Date().getFullYear();
        const invoiceNumber = `FAC-${year}-${nextNum.toString().padStart(4, '0')}`;

        // Validate products and stock
        const stockUpdates: { ref: any, newStock: number }[] = [];
        for (let i = 0; i < cart.length; i++) {
          const item = cart[i];
          const productSnap = productSnaps[i];
          if (!productSnap.exists()) throw new Error(invoiceT('ui.errors.productMissing', { name: item.name }));
          const currentStock = productSnap.data().stock || 0;
          if (currentStock < item.quantity) throw new Error(invoiceT('ui.errors.stockInsufficient', { name: item.name, stock: currentStock }));
          stockUpdates.push({
            ref: doc(db, 'products', item.productId),
            newStock: currentStock - item.quantity
          });
        }

        // Validate client
        let clientUpdate = null;
        if (selectedClient && remainingDebt > 0) {
          if (!clientSnap || !clientSnap.exists()) throw new Error(invoiceT('ui.errors.clientMissing'));
          const currentDebt = clientSnap.data().debt || 0;
          clientUpdate = {
            ref: doc(db, 'clients', selectedClient.id),
            newDebt: currentDebt + remainingDebt
          };
        }

        // 3. ALL WRITES LAST
        transaction.set(counterRef, { lastNum: nextNum }, { merge: true });
        addCashSessionTotals(transaction, activeCashSession, {
          sales: cartTotal,
          cash: paidAmount,
        });

        for (const update of stockUpdates) {
          transaction.update(update.ref, { stock: update.newStock });
        }

        if (clientUpdate) {
          transaction.update(clientUpdate.ref, { debt: clientUpdate.newDebt });
        }

        const saleData = {
          date: serverTimestamp(),
          clientId: selectedClient?.id || null,
          clientCode: selectedClient?.code || '',
          clientName: selectedClient?.name || 'Client de passage',
          total: cartTotal,
          paid: paidAmount,
          debt: remainingDebt,
          tva: tvaAmount,
          subtotal: financialTotals.subtotal,
          discount: financialTotals.discount,
          tvaEnabled: storeSettings?.tvaEnabled === true,
          tvaRate: storeSettings?.tvaEnabled === true ? Number(storeSettings.tva) || 0 : 0,
          items: cart,
          invoiceId: invoiceRef.id,
          sessionId: activeCashSession.id,
          ownerId,
          userId: userProfile?.uid || ownerId,
          createdBy: actor,
          updatedBy: actor,
          updatedAt: serverTimestamp(),
        };

        const invoiceData = {
          id: invoiceRef.id,
          number: invoiceNumber,
          saleId: saleRef.id,
          clientId: selectedClient?.id || null,
          clientCode: selectedClient?.code || '',
          clientName: selectedClient?.name || 'Client de passage',
          clientPhone: selectedClient?.phone || '',
          clientAddress: selectedClient?.address || '',
          total: cartTotal,
          paid: paidAmount,
          debt: remainingDebt,
          tva: tvaAmount,
          subtotal: financialTotals.subtotal,
          discount: financialTotals.discount,
          tvaEnabled: storeSettings?.tvaEnabled === true,
          tvaRate: storeSettings?.tvaEnabled === true ? Number(storeSettings.tva) || 0 : 0,
          date: serverTimestamp(),
          items: cart,
          sessionId: activeCashSession.id,
          ownerId,
          userId: userProfile?.uid || ownerId,
          createdBy: actor,
          updatedBy: actor,
          updatedAt: serverTimestamp(),
        };

        transaction.set(saleRef, saleData);
        transaction.set(invoiceRef, invoiceData);
      });

      await Promise.all([
        logAudit({
          ownerId,
          entity: 'sale',
          entityId: saleRef.id,
          action: 'create',
          actor,
          summary: { after: { total: cartTotal, client: selectedClient?.name || 'Client de passage', status: 'created' } },
        }),
        logAudit({
          ownerId,
          entity: 'invoice',
          entityId: invoiceRef.id,
          action: 'create',
          actor,
          summary: { after: { total: cartTotal, client: selectedClient?.name || 'Client de passage', status: 'created' } },
        }),
      ]);

      try {
        await apiFetch(`/financial/sales/${encodeURIComponent(saleRef.id)}/costs`, { method: 'POST' });
      } catch (costError) {
        console.error('Invoice sale purchase-cost snapshot failed after commit.');
        setError(invoiceT('ui.errors.saleCostFailed', { details: costError instanceof Error ? costError.message : '' }));
      }

      setSaleSuccess(invoiceT('ui.errors.invoiceSuccess'));
      setTimeout(() => {
        setSaleSuccess(null);
        setIsNewInvoiceModalOpen(false);
        setCart([]);
        setPaidAmount(0);
        setSelectedClient(null);
      }, 2000);
    } catch (err: any) {
      console.error('Transaction failed:', err);
      setError(err.message);
      handleFirestoreError(err, OperationType.WRITE, 'sales');
    } finally {
      setIsProcessing(false);
    }
  };

  const createQuickSupplier = async () => {
    const name = quickSupplierName.trim();
    if (!isStoreAdmin || !ownerId || !name) {
      setPurchaseError(invoiceT('ui.errors.supplierRequired'));
      return;
    }
    try {
      const supplierRef = doc(collection(db, 'suppliers'));
      await setDoc(supplierRef, {
        ownerId,
        name,
        createdAt: serverTimestamp(),
        createdBy: userProfile?.uid,
      });
      setPurchaseSupplierId(supplierRef.id);
      setQuickSupplierName('');
      setPurchaseError('');
    } catch (cause) {
      setPurchaseError(cause instanceof Error ? cause.message : invoiceT('ui.errors.quickSupplierFailed'));
    }
  };

  const handlePurchaseAttachment = async (file: File | undefined) => {
    setPurchaseError('');
    if (!file) return;
    setPurchaseFileLoading(true);
    try {
      setPurchaseAttachment(await compressPurchaseImage(file, key => invoiceT(`ui.errors.${key}`)));
      setPurchaseAttachmentUrl('');
    } catch (cause) {
      setPurchaseError(cause instanceof Error ? cause.message : invoiceT('ui.errors.attachmentFailed'));
    } finally {
      setPurchaseFileLoading(false);
    }
  };

  const submitPurchase = async (event: React.FormEvent) => {
    event.preventDefault();
    setPurchaseError('');
    setPurchaseSuccess('');
    if (!isStoreAdmin || !ownerId || !userProfile || !auth.currentUser) {
      setPurchaseError(invoiceT('ui.errors.storeAdminOnly'));
      return;
    }
    if (!purchaseSupplierId || !purchaseLines.length) {
      setPurchaseError(invoiceT('ui.errors.supplierAndLineRequired'));
      return;
    }
    const normalizedNumber = purchaseNumber.trim().toLocaleUpperCase('fr');
    if (!/^[A-Z0-9][A-Z0-9._-]{0,59}$/.test(normalizedNumber)) {
      setPurchaseError(invoiceT('ui.errors.invoiceNumberFormat'));
      return;
    }
    const paidAmount = Number(purchasePaidAmount.replace(',', '.'));
    let totals;
    try {
      totals = calculatePurchaseTotals(purchaseLines, paidAmount);
    } catch (cause) {
      setPurchaseError(cause instanceof Error ? cause.message : invoiceT('ui.errors.purchaseLinesInvalid'));
      return;
    }
    let attachment: PurchaseAttachment | undefined;
    if (purchaseAttachmentUrl.trim()) {
      if (!/^https:\/\/\S+$/i.test(purchaseAttachmentUrl.trim())) {
        setPurchaseError(invoiceT('ui.errors.httpsRequired'));
        return;
      }
      attachment = { url: purchaseAttachmentUrl.trim(), fileName: 'Lien fournisseur' };
    } else if (purchaseAttachment) {
      attachment = purchaseAttachment;
    }

    setPurchaseSaving(true);
    try {
      const purchaseRef = doc(db, 'purchases', `purchase_${ownerId}_${normalizedNumber}`);
      const supplierRef = doc(db, 'suppliers', purchaseSupplierId);
      const debtRef = doc(db, 'supplier_debts', purchaseSupplierId);
      const paymentRef = doc(collection(db, 'supplier_debts', purchaseSupplierId, 'payments'));
      const itemRefs = purchaseLines.map(line => doc(db, line.itemCollection, line.itemId));
      await runTransaction(db, async transaction => {
        const [purchaseSnapshot, supplierSnapshot, debtSnapshot] = await Promise.all([
          transaction.get(purchaseRef),
          transaction.get(supplierRef),
          transaction.get(debtRef),
        ]);
        if (purchaseSnapshot.exists()) throw new Error(invoiceT('ui.errors.invoiceAlreadyExists'));
        if (!supplierSnapshot.exists() || supplierSnapshot.data().ownerId !== ownerId) {
          throw new Error(invoiceT('ui.errors.supplierMissing'));
        }
        const itemSnapshots = await Promise.all(itemRefs.map(ref => transaction.get(ref)));
        const activeSession = totals.paidMilli > 0
          ? await requireOpenCashSession(transaction, userProfile.uid, ownerId)
          : null;
        const stockUpdates = itemSnapshots.map((snapshot, index) => {
          const line = purchaseLines[index];
          if (!snapshot.exists() || snapshot.data().ownerId !== ownerId) {
            throw new Error(invoiceT('ui.errors.itemMissing', { name: line.nameSnapshot }));
          }
          if (snapshot.data().inventoryType === 'service') {
            throw new Error(invoiceT('ui.errors.serviceNoStock'));
          }
          const version = (Number(snapshot.data().stockVersion) || 0) + 1;
          return {
            ref: itemRefs[index],
            line,
            stock: getPurchaseReceiptStock(Number(snapshot.data().stock) || 0, line.quantity),
            version,
            movementId: `${line.itemCollection === 'parts' ? 'part' : 'product'}_${line.itemId}_v${version}`,
          };
        });
        const supplierName = String(supplierSnapshot.data().name || 'Fournisseur');
        const currentDebtMilli = Number(debtSnapshot.data()?.balanceMilli) || 0;
        const debtMilli = currentDebtMilli + totals.debtMilli;
        if (!Number.isSafeInteger(debtMilli)) throw new Error(invoiceT('ui.errors.supplierBalanceTooLarge'));
        const purchaseDateValue = Timestamp.fromDate(new Date(`${purchaseDate}T12:00:00`));

        transaction.set(purchaseRef, {
          ownerId,
          number: normalizedNumber,
          date: purchaseDateValue,
          supplierId: purchaseSupplierId,
          supplierName,
          items: purchaseLines,
          totalMilli: totals.totalMilli,
          paidMilli: totals.paidMilli,
          debtMilli: totals.debtMilli,
          note: purchaseNote.trim(),
          ...(attachment ? { attachment } : {}),
          status: 'received',
          createdAt: serverTimestamp(),
          createdBy: userProfile.uid,
          ...(totals.paidMilli > 0 ? { lastPaymentId: paymentRef.id } : {}),
          ...(activeSession ? { sessionId: activeSession.id } : {}),
        });
        transaction.set(debtRef, {
          ownerId,
          supplierId: purchaseSupplierId,
          supplierName,
          balanceMilli: debtMilli,
          lastEntryId: totals.paidMilli > 0 ? paymentRef.id : purchaseRef.id,
          updatedAt: serverTimestamp(),
        }, { merge: true });

        stockUpdates.forEach(({ ref, line, stock, version, movementId }, index) => {
          transaction.update(ref, {
            stock,
            stockVersion: version,
            lastStockMovementId: movementId,
            ownerId,
            userId: userProfile.uid,
          });
          transaction.set(doc(db, 'stock_movements', movementId), {
            type: 'purchase_restock',
            inventoryCollection: line.itemCollection,
            productId: line.itemId,
            productName: line.nameSnapshot,
            purchaseId: purchaseRef.id,
            purchaseNumber: normalizedNumber,
            lineIndex: index,
            delta: line.quantity,
            quantity: line.quantity,
            version,
            ownerId,
            userId: userProfile.uid,
            userLabel: userProfile.name || userProfile.email || 'Administrateur',
            createdAt: serverTimestamp(),
          });
          transaction.set(doc(db, line.itemCollection === 'parts' ? 'part_costs' : 'product_costs', line.itemId), {
            ownerId,
            buyPrice: line.unitCostMilli / 1000,
            currentUnitCostMilli: line.unitCostMilli,
            updatedAt: serverTimestamp(),
            updatedBy: userProfile.uid,
          }, { merge: true });
        });

        if (totals.paidMilli > 0 && activeSession) {
          transaction.set(paymentRef, {
            ownerId,
            supplierId: purchaseSupplierId,
            supplierName,
            purchaseId: purchaseRef.id,
            purchaseNumber: normalizedNumber,
            amountMilli: totals.paidMilli,
            type: 'purchase_initial_payment',
            sessionId: activeSession.id,
            createdAt: serverTimestamp(),
            createdBy: userProfile.uid,
          });
          addCashSessionTotals(transaction, activeSession, {
            expenses: totals.paidMilli / 1000,
            expensesCash: totals.paidMilli / 1000,
          });
        }
      });
      setPurchaseSuccess(`Facture ${normalizedNumber} enregistrée ; le stock et le coût d’achat ont été mis à jour.`);
      setPurchaseLines([]);
      setPurchasePaidAmount('0');
      setPurchaseNote('');
      setPurchaseAttachment(null);
      setPurchaseAttachmentUrl('');
      setPurchaseNumber(`ACH-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`);
      setIsPurchaseModalOpen(false);
    } catch (cause) {
      setPurchaseError(cause instanceof Error ? cause.message : 'Impossible d’enregistrer la facture d’achat.');
    } finally {
      setPurchaseSaving(false);
    }
  };

  const payPurchaseDebt = async () => {
    if (!selectedPurchase || !selectedPurchase.supplierId || !ownerId || !userProfile || !isStoreAdmin) return;
    setPurchaseError('');
    let paymentMilli: number;
    try {
      paymentMilli = getPurchasePaymentBalance(
        Number(selectedPurchase.debtMilli) || 0,
        Number(supplierPaymentAmount.replace(',', '.')),
      ).paymentMilli;
    } catch (cause) {
      setPurchaseError(cause instanceof Error ? cause.message : invoiceT('ui.errors.paymentAmountInvalid'));
      return;
    }

    setPaymentSaving(true);
    try {
      const purchaseRef = doc(db, 'purchases', selectedPurchase.id);
      const debtRef = doc(db, 'supplier_debts', selectedPurchase.supplierId);
      const paymentRef = doc(collection(db, 'supplier_debts', selectedPurchase.supplierId, 'payments'));
      await runTransaction(db, async transaction => {
        const [purchaseSnapshot, debtSnapshot] = await Promise.all([
          transaction.get(purchaseRef),
          transaction.get(debtRef),
        ]);
        if (!purchaseSnapshot.exists()) throw new Error(invoiceT('ui.errors.purchaseNotFound'));
        const purchase = purchaseSnapshot.data();
        if (purchase.ownerId !== ownerId || purchase.status !== 'received') {
          throw new Error(invoiceT('ui.errors.purchaseCannotSettle'));
        }
        const currentInvoiceDebt = Number(purchase.debtMilli) || 0;
        getPurchasePaymentBalance(currentInvoiceDebt, paymentMilli / 1000);
        if (!debtSnapshot.exists() || debtSnapshot.data().ownerId !== ownerId) {
          throw new Error(invoiceT('ui.errors.supplierDebtMissing'));
        }
        const activeSession = await requireOpenCashSession(transaction, userProfile.uid, ownerId);
        const supplierBalance = Number(debtSnapshot.data().balanceMilli) || 0;
        if (supplierBalance < paymentMilli) {
          throw new Error(invoiceT('ui.errors.debtTooSmall'));
        }
        const nextPaid = (Number(purchase.paidMilli) || 0) + paymentMilli;
        const nextInvoiceDebt = currentInvoiceDebt - paymentMilli;
        transaction.update(purchaseRef, {
          paidMilli: nextPaid,
          debtMilli: nextInvoiceDebt,
          lastPaymentId: paymentRef.id,
          updatedAt: serverTimestamp(),
        });
        transaction.update(debtRef, {
          balanceMilli: supplierBalance - paymentMilli,
          lastEntryId: paymentRef.id,
          updatedAt: serverTimestamp(),
        });
        transaction.set(paymentRef, {
          ownerId,
          supplierId: selectedPurchase.supplierId,
          supplierName: purchase.supplierName || selectedPurchase.supplierName || '',
          purchaseId: purchaseRef.id,
          purchaseNumber: purchase.number,
          amountMilli: paymentMilli,
          type: 'purchase_debt_payment',
          sessionId: activeSession.id,
          createdAt: serverTimestamp(),
          createdBy: userProfile.uid,
        });
        addCashSessionTotals(transaction, activeSession, {
          expenses: paymentMilli / 1000,
          expensesCash: paymentMilli / 1000,
        });
      });
      setSupplierPaymentAmount('');
      setPurchaseError('');
    } catch (cause) {
      setPurchaseError(cause instanceof Error ? cause.message : invoiceT('ui.errors.settlementFailed'));
    } finally {
      setPaymentSaving(false);
    }
  };

  const cancelPurchaseInvoice = async () => {
    if (!selectedPurchase || !selectedPurchase.supplierId || !ownerId || !userProfile || !isStoreAdmin) return;
    setPurchaseError('');
    setPaymentSaving(true);
    try {
      const purchaseRef = doc(db, 'purchases', selectedPurchase.id);
      const debtRef = doc(db, 'supplier_debts', selectedPurchase.supplierId);
      const lines = selectedPurchase.items || [];
      if (!lines.length) throw new Error(invoiceT('ui.errors.noStockLines'));
      const itemRefs = lines.map(line => doc(db, line.itemCollection, line.itemId));
      const paymentRef = doc(collection(db, 'supplier_debts', selectedPurchase.supplierId, 'payments'));
      await runTransaction(db, async transaction => {
        const [purchaseSnapshot, debtSnapshot] = await Promise.all([
          transaction.get(purchaseRef),
          transaction.get(debtRef),
        ]);
        if (!purchaseSnapshot.exists()) throw new Error(invoiceT('ui.errors.purchaseNotFound'));
        const purchase = purchaseSnapshot.data();
        if (purchase.ownerId !== ownerId || purchase.status !== 'received') {
          throw new Error(invoiceT('ui.errors.purchaseNotCancellable'));
        }
        if (!debtSnapshot.exists() || debtSnapshot.data().ownerId !== ownerId) {
          throw new Error(invoiceT('ui.errors.supplierDebtMissing'));
        }
        const snapshots = await Promise.all(itemRefs.map(ref => transaction.get(ref)));
        const stockUpdates = snapshots.map((snapshot, index) => {
          const line = lines[index];
          if (!snapshot.exists() || snapshot.data().ownerId !== ownerId) {
            throw new Error(invoiceT('ui.errors.stockItemUnavailable', { name: line.nameSnapshot }));
          }
          let nextStock: number;
          try {
            nextStock = getPurchaseCancellationStock(Number(snapshot.data().stock) || 0, Number(line.quantity));
          } catch {
            throw new Error(invoiceT('ui.errors.stockInsufficientForCancel', {
              name: line.nameSnapshot,
              stock: snapshot.data().stock || 0,
              quantity: line.quantity,
            }));
          }
          const version = (Number(snapshot.data().stockVersion) || 0) + 1;
          return {
            ref: itemRefs[index],
            line,
            stock: nextStock,
            version,
            movementId: `${line.itemCollection === 'parts' ? 'part' : 'product'}_${line.itemId}_v${version}`,
          };
        });
        const purchaseDebt = Number(purchase.debtMilli) || 0;
        const purchasePaid = Number(purchase.paidMilli) || 0;
        const supplierBalance = Number(debtSnapshot.data().balanceMilli) || 0;
        const newSupplierBalance = supplierBalance - purchaseDebt - purchasePaid;
        if (!Number.isSafeInteger(newSupplierBalance)) throw new Error(invoiceT('ui.errors.supplierBalanceTooLarge'));
        const cancellationRecord = {
          ownerId,
          supplierId: selectedPurchase.supplierId,
          supplierName: purchase.supplierName || selectedPurchase.supplierName || '',
          purchaseId: purchaseRef.id,
          purchaseNumber: purchase.number,
          amountMilli: -purchasePaid,
          debtReversedMilli: purchaseDebt,
          type: 'purchase_cancellation_credit',
          createdAt: serverTimestamp(),
          createdBy: userProfile.uid,
        };
        transaction.update(purchaseRef, {
          status: 'cancelled',
          debtMilli: 0,
          lastPaymentId: paymentRef.id,
          cancelledAt: serverTimestamp(),
          cancelledBy: userProfile.uid,
          cancellationReason: 'Annulation administrative avec reprise du stock disponible.',
          updatedAt: serverTimestamp(),
        });
        transaction.update(debtRef, {
          balanceMilli: newSupplierBalance,
          lastEntryId: paymentRef.id,
          updatedAt: serverTimestamp(),
        });
        stockUpdates.forEach(({ ref, line, stock, version, movementId }, index) => {
          transaction.update(ref, {
            stock,
            stockVersion: version,
            lastStockMovementId: movementId,
            ownerId,
            userId: userProfile.uid,
          });
          transaction.set(doc(db, 'stock_movements', movementId), {
            type: 'purchase_cancel',
            inventoryCollection: line.itemCollection,
            productId: line.itemId,
            productName: line.nameSnapshot,
            purchaseId: purchaseRef.id,
            purchaseNumber: purchase.number,
            lineIndex: index,
            delta: -line.quantity,
            quantity: line.quantity,
            version,
            ownerId,
            userId: userProfile.uid,
            userLabel: userProfile.name || userProfile.email || 'Administrateur',
            createdAt: serverTimestamp(),
          });
        });
        transaction.set(paymentRef, cancellationRecord);
      });
      setShowPurchaseCancelConfirm(false);
      setSelectedPurchase(null);
      setPurchaseError('');
    } catch (cause) {
      setPurchaseError(cause instanceof Error ? cause.message : invoiceT('ui.errors.cancelFailed'));
    } finally {
      setPaymentSaving(false);
    }
  };

  const downloadPDF = async (invoice: Invoice) => {
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error(invoiceT('ui.errors.sessionInvalid'));
      const idToken = await currentUser.getIdToken();
      const response = await apiFetch('/invoices/pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({
          ...invoice,
          items: invoice.items.map(item => ({
            ...item,
            details: formatProductDetails(item.attributes, item.serialNumber),
          })),
          storeName: storeSettings?.storeName || brand.storeName,
          address: storeSettings?.address,
          phone: storeSettings?.phone,
          documentLanguage: storeSettings?.documentLanguage || 'fr',
          date: formatDocumentDate(invoice.date?.toDate ? invoice.date.toDate() : new Date(), storeSettings?.documentLanguage || 'fr')
        })
      });
      if (!response.ok) throw new Error(invoiceT('ui.errors.pdfFailed'));
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

  const matchesDateRange = (value: unknown) => {
    const date = toInvoiceDate(value);
    if (!date) return !startDate && !endDate;
    const start = startDate ? new Date(`${startDate}T00:00:00`) : null;
    const end = endDate ? new Date(`${endDate}T23:59:59.999`) : null;
    return (!start || date >= start) && (!end || date <= end);
  };
  const normalizedSearch = searchTerm.trim().toLocaleLowerCase('fr');
  const filteredInvoices = invoices.filter(inv =>
    (!normalizedSearch ||
      inv.number.toLocaleLowerCase('fr').includes(normalizedSearch) ||
      inv.clientName.toLocaleLowerCase('fr').includes(normalizedSearch) ||
      (inv.clientCode || '').toLocaleLowerCase('fr').includes(normalizedSearch)) &&
    matchesDateRange(inv.date)
  );
  const filteredPurchases = purchaseInvoices.filter(purchase => {
    const number = purchase.invoiceNumber || purchase.number || purchase.id;
    const supplier = purchase.supplierName || purchase.supplierId || '';
    return (!normalizedSearch ||
      number.toLocaleLowerCase('fr').includes(normalizedSearch) ||
      supplier.toLocaleLowerCase('fr').includes(normalizedSearch)) &&
      matchesDateRange(purchase.date);
  });

  return (
    <div className="relative min-w-0 space-y-6">
      {/* Hidden printable ticket for Invoices - Render outside #root using Portal */}
      {createPortal(
        <div className="print-container">
          {selectedInvoice && (
            <PrintableTicket invoice={selectedInvoice} ownerId={ownerId} />
          )}
        </div>,
        document.body
      )}

      <PageHeader
        title={invoiceT('ui.title')}
        description={invoiceT('ui.description')}
        actions={activeTab === 'sales' ? <Button onClick={() => setIsNewInvoiceModalOpen(true)}>
          <Plus className="h-4 w-4" />
          {invoiceT('ui.newInvoice')}
        </Button> : isStoreAdmin ? <Button onClick={() => {
          setPurchaseError('');
          setPurchaseSuccess('');
          setPurchaseLines([]);
          setPurchasePaidAmount('0');
          setPurchaseNumber(`ACH-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`);
          setIsPurchaseModalOpen(true);
        }}>
          <Plus className="h-4 w-4" />
          {invoiceT('ui.newPurchase')}
        </Button> : undefined}
      />
      {purchaseSuccess && <Badge variant="success" role="status" className="w-full justify-start rounded-ds-md">{purchaseSuccess}</Badge>}

      <Card className="overflow-hidden p-0">
        <div className="flex flex-col gap-4 border-b border-ds-border bg-ds-surface-2 p-4 sm:p-5">
          <div className="flex flex-wrap gap-2" role="tablist" aria-label={invoiceT('ui.invoiceType')}>
            <Button type="button" role="tab" aria-selected={activeTab === 'sales'} onClick={() => setActiveTab('sales')}
              variant={activeTab === 'sales' ? 'primary' : 'secondary'}>{invoiceT('ui.salesTab')}</Button>
            <Button type="button" role="tab" aria-selected={activeTab === 'purchases'} onClick={() => setActiveTab('purchases')}
              variant={activeTab === 'purchases' ? 'primary' : 'secondary'}>{invoiceT('ui.purchasesTab')}</Button>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="relative min-w-0 flex-1 sm:min-w-56">
              <Search className="absolute start-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-ds-muted" />
              <Input
                type="text"
                placeholder={invoiceT(activeTab === 'sales' ? 'ui.searchSales' : 'ui.searchPurchases')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="ps-11"
              />
            </div>
            <label className="flex items-center gap-2 text-xs font-semibold text-ds-text-muted">
              {invoiceT('ui.from')} <Input aria-label={invoiceT('ui.startDate')} type="date" value={startDate} max={endDate || undefined} onChange={event => setStartDate(event.target.value)} className="w-auto px-2.5 text-sm" />
            </label>
            <label className="flex items-center gap-2 text-xs font-semibold text-ds-text-muted">
              {invoiceT('ui.to')} <Input aria-label={invoiceT('ui.endDate')} type="date" value={endDate} min={startDate || undefined} onChange={event => setEndDate(event.target.value)} className="w-auto px-2.5 text-sm" />
            </label>
          </div>
        </div>

        {activeTab === 'sales' ? (
        <div className="overflow-x-auto text-[13px] font-medium text-ds-text-muted">
          <table className="responsive-card-table w-full min-w-[640px] border-collapse text-start">
            <thead>
              <tr className="border-b border-ds-border bg-ds-surface-2 text-[10px] font-extrabold uppercase tracking-widest text-ds-muted">
                <th className="px-6 py-4">{invoiceT('ui.invoiceNumber')}</th>
                <th className="px-6 py-4">{invoiceT('ui.date')}</th>
                <th className="px-6 py-4">{invoiceT('ui.client')}</th>
                <th className="px-6 py-4">{invoiceT('ui.total')}</th>
                <th className="px-6 py-4 text-end">{invoiceT('ui.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ds-border">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10"><EmptyState title={invoiceT('ui.loadingInvoices')} /></td>
                </tr>
              ) : filteredInvoices.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10"><EmptyState title={invoiceT('ui.noInvoiceFound')} /></td>
                </tr>
              ) : (
                filteredInvoices.map((invoice) => (
                  <tr key={invoice.id} className="transition-colors hover:bg-ds-surface-2">
                    <td data-label={invoiceT('ui.invoiceNumber')} className="px-6 py-4 font-bold text-ds-text">{invoice.number}</td>
                    <td data-label={invoiceT('ui.date')} className="px-6 py-4 text-sm text-ds-text-muted">
                      {invoice.date?.toDate ? formatDateTime(invoice.date.toDate(), { dateStyle: 'medium' }) : invoiceT('ui.unknownDate')}
                    </td>
                    <td data-label={invoiceT('ui.client')} className="px-6 py-4">
                      <div className="text-sm font-medium text-ds-text">{invoice.clientName}</div>
                      {invoice.clientCode && <div className="text-[10px] font-mono uppercase tracking-tighter text-ds-muted">{invoiceT('ui.code')}: {invoice.clientCode}</div>}
                      {invoice.clientPhone && <div className="text-xs text-ds-text-muted">{invoice.clientPhone}</div>}
                    </td>
                    <td data-label={invoiceT('ui.total')} className="px-6 py-4 font-mono font-black text-ds-text">{invoice.total.toFixed(3)} {storeSettings?.currency || 'DT'}</td>
                    <td data-label={invoiceT('ui.actions')} className="px-6 py-4 text-end">
                      <div className="flex items-center justify-end gap-2">
                        <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedInvoice(invoice)} aria-label={invoiceT('ui.viewInvoice')}>
                          <Eye className="h-5 w-5" />
                        </Button>
                        <Button type="button" variant="ghost" size="sm" onClick={() => downloadPDF(invoice)} aria-label={invoiceT('ui.downloadInvoice')}>
                          <Download className="h-5 w-5 text-ds-info" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        ) : !isStoreAdmin ? (
          <p className="p-8 text-center text-sm font-semibold text-ds-muted">{invoiceT('ui.purchaseAdminOnly')}</p>
        ) : (
          <div className="overflow-x-auto text-[13px] font-medium text-ds-text-muted">
            <table className="responsive-card-table w-full min-w-[850px] border-collapse text-start">
              <thead>
                <tr className="border-b border-ds-border bg-ds-surface-2 text-[10px] font-extrabold uppercase tracking-widest text-ds-muted">
                  <th className="px-6 py-4">{invoiceT('ui.purchaseNumber')}</th>
                  <th className="px-6 py-4">{invoiceT('ui.date')}</th>
                  <th className="px-6 py-4">{invoiceT('ui.supplier')}</th>
                  <th className="px-6 py-4 text-end">{invoiceT('ui.total')}</th>
                  <th className="px-6 py-4 text-end">{invoiceT('ui.due')}</th>
                  <th className="px-6 py-4">{invoiceT('ui.status')}</th>
                  <th className="px-6 py-4 text-end">{invoiceT('ui.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ds-border">
                {loading ? <tr><td colSpan={7} className="px-6 py-10"><EmptyState title={invoiceT('ui.loadingPurchases')} /></td></tr> :
                  filteredPurchases.length === 0 ? <tr><td colSpan={7} className="px-6 py-10"><EmptyState title={invoiceT('ui.noPurchases')} /></td></tr> :
                  filteredPurchases.map(purchase => {
                    const purchaseDate = toInvoiceDate(purchase.date);
                    const total = typeof purchase.total === 'number' ? purchase.total : (Number(purchase.totalMilli) || 0) / 1000;
                    const debt = (Number(purchase.debtMilli) || 0) / 1000;
                    const number = purchase.invoiceNumber || purchase.number || `Achat-${purchase.id.slice(0, 8)}`;
                    return (
                      <tr key={purchase.id} className="transition-colors hover:bg-ds-surface-2">
                        <td data-label={invoiceT('ui.purchaseNumber')} className="px-6 py-4 font-bold text-ds-text">{number}</td>
                        <td data-label={invoiceT('ui.date')} className="px-6 py-4">{purchaseDate ? formatDateTime(purchaseDate, { dateStyle: 'medium' }) : invoiceT('ui.unknownDate')}</td>
                        <td data-label={invoiceT('ui.supplier')} className="px-6 py-4">{purchase.supplierName || purchase.supplierId || invoiceT('ui.supplierNotProvided')}</td>
                        <td data-label={invoiceT('ui.total')} className="px-6 py-4 text-end font-mono font-bold">{total.toFixed(3)} {storeSettings?.currency || 'DT'}</td>
                        <td data-label={invoiceT('ui.due')} className="px-6 py-4 text-end font-mono font-bold text-ds-warning">{debt.toFixed(3)} {storeSettings?.currency || 'DT'}</td>
                        <td data-label={invoiceT('ui.status')} className="px-6 py-4"><Badge variant={purchase.status === 'cancelled' ? 'danger' : 'success'}>{purchase.status === 'cancelled' ? invoiceT('ui.cancelled') : invoiceT('ui.received')}</Badge></td>
                        <td data-label={invoiceT('ui.actions')} className="px-6 py-4 text-end">
                          <Button type="button" variant="secondary" size="sm" onClick={() => { setSelectedPurchase(purchase); setSupplierPaymentAmount(''); setPurchaseError(''); }}>{invoiceT('ui.detailsPay')}</Button>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {isPurchaseModalOpen && isStoreAdmin && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-2 sm:p-4">
          <form onSubmit={submitPurchase} className="flex max-h-[96vh] w-full max-w-4xl flex-col overflow-hidden rounded-ds-lg border border-ds-border bg-ds-surface shadow-ds-md">
            <header className="flex items-start justify-between gap-4 border-b border-ds-border p-5 sm:p-6">
              <div>
                <h2 className="text-xl font-black text-ds-text">{invoiceT('ui.newPurchase')}</h2>
                <p className="mt-1 text-sm text-ds-muted">{invoiceT('ui.newPurchaseDescription')}</p>
              </div>
              <Button type="button" variant="ghost" onClick={() => setIsPurchaseModalOpen(false)} disabled={purchaseSaving} aria-label={invoiceT('ui.close')}><X className="h-5 w-5" /></Button>
            </header>

            <div className="flex-1 space-y-5 overflow-y-auto p-5 sm:p-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <Select label={invoiceT('ui.supplier')} value={purchaseSupplierId} onChange={event => setPurchaseSupplierId(event.target.value)} required>
                    <option value="">{invoiceT('ui.selectSupplier')}</option>
                    {suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                </Select>
                <div className="flex items-end gap-2">
                  <Input label={invoiceT('ui.quickSupplier')} value={quickSupplierName} onChange={event => setQuickSupplierName(event.target.value)} maxLength={120} className="min-w-0" placeholder={invoiceT('ui.supplierName')} />
                  <Button type="button" variant="secondary" onClick={createQuickSupplier} disabled={!quickSupplierName.trim()} className="shrink-0">{invoiceT('ui.add')}</Button>
                </div>
                <Input label={invoiceT('ui.invoiceNumberField')} value={purchaseNumber} onChange={event => setPurchaseNumber(event.target.value)} required maxLength={60} pattern="[A-Za-z0-9][A-Za-z0-9._-]{0,59}" />
                <Input label={invoiceT('ui.date')} type="date" value={purchaseDate} onChange={event => setPurchaseDate(event.target.value)} required />
              </div>

              <section className="space-y-3 rounded-ds-lg border border-ds-border p-4">
                <h3 className="text-sm font-black text-ds-text">{invoiceT('ui.lines')}</h3>
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_100px_150px_auto]">
                  <Select aria-label={invoiceT('ui.itemOrPart')} value={purchaseItemId} onChange={event => setPurchaseItemId(event.target.value)}>
                    <option value="">{invoiceT('ui.chooseItem')}</option>
                    {purchaseCatalog.map(item => <option key={`${item.collection}:${item.id}`} value={`${item.collection}:${item.id}`}>{item.collection === 'parts' ? invoiceT('ui.part') : invoiceT('ui.item')} — {item.name} ({invoiceT('ui.stock')} {item.stock})</option>)}
                  </Select>
                  <Input aria-label={invoiceT('ui.receivedQuantity')} type="number" min="1" step="1" value={purchaseItemQuantity} onChange={event => setPurchaseItemQuantity(event.target.value)} />
                  <Input aria-label={invoiceT('ui.unitPurchasePrice')} type="number" min="0" step="0.001" value={purchaseItemCost} onChange={event => setPurchaseItemCost(event.target.value)} placeholder={invoiceT('ui.unitCost')} />
                  <Button type="button" onClick={addPurchaseLine}><Plus className="h-4 w-4" /> {invoiceT('ui.add')}</Button>
                </div>
                {purchaseLines.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] text-start text-sm">
                      <thead className="bg-ds-surface-2 text-[10px] uppercase tracking-wide text-ds-muted"><tr><th className="py-2">{invoiceT('ui.item')}</th><th>{invoiceT('ui.quantity')}</th><th>{invoiceT('ui.unitCost')}</th><th className="text-end">{invoiceT('ui.total')}</th><th /></tr></thead>
                      <tbody className="divide-y divide-ds-border text-ds-text">
                        {purchaseLines.map((line, index) => (
                          <tr key={`${line.itemCollection}:${line.itemId}`}>
                            <td className="py-2 font-semibold">{line.nameSnapshot} <span className="text-[10px] text-ds-muted">{line.itemCollection === 'parts' ? invoiceT('ui.part') : invoiceT('ui.item')}</span></td>
                            <td>{line.quantity}</td>
                            <td className="font-mono">{(line.unitCostMilli / 1000).toFixed(3)} DT</td>
                            <td className="text-end font-mono font-bold">{(line.quantity * line.unitCostMilli / 1000).toFixed(3)} DT</td>
                            <td className="text-end"><Button type="button" variant="ghost" size="sm" onClick={() => setPurchaseLines(current => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={invoiceT('ui.removeItem', { name: line.nameSnapshot })}><Trash2 className="h-4 w-4 text-ds-danger" /></Button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <p className="text-sm text-ds-muted">{invoiceT('ui.addLineHint')}</p>}
              </section>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Input label={invoiceT('ui.paidAmount')} type="number" min="0" step="0.001" max={purchaseTotalMilli / 1000} value={purchasePaidAmount} onChange={event => setPurchasePaidAmount(event.target.value)} className="font-mono" />
                  {Number(purchasePaidAmount.replace(',', '.')) > 0 && !cashSession && <p className="text-sm font-medium text-ds-warning">{cashSessionLoading ? invoiceT('ui.cashChecking') : invoiceT('ui.cashRequiredPayment')}</p>}
                </div>
                <div className="rounded-ds-md bg-ds-surface-2 p-3 text-sm text-ds-text">
                  <div className="flex justify-between"><span>{invoiceT('ui.calculatedTotal')}</span><strong className="font-mono">{(purchaseTotalMilli / 1000).toFixed(3)} DT</strong></div>
                  <div className="mt-2 flex justify-between text-ds-warning"><span>{invoiceT('ui.remainingToPay')}</span><strong className="font-mono">{(purchaseDebtMilli / 1000).toFixed(3)} DT</strong></div>
                </div>
                <label className="grid gap-1.5 text-sm font-medium text-ds-text sm:col-span-2">
                  {invoiceT('ui.note')}
                  <textarea value={purchaseNote} onChange={event => setPurchaseNote(event.target.value)} maxLength={1000} rows={2} className="w-full rounded-ds-md border border-ds-border bg-ds-surface px-3 py-2 text-base text-ds-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-ds-brand" />
                </label>
                <div className="space-y-2 sm:col-span-2">
                  <Input label={<><Paperclip className="me-1 inline h-3.5 w-3.5" />{invoiceT('ui.attachment')}</>} type="url" value={purchaseAttachmentUrl} onChange={event => { setPurchaseAttachmentUrl(event.target.value); setPurchaseAttachment(null); }} placeholder="https://…" />
                  <Input type="file" accept="image/*" disabled={purchaseFileLoading} onChange={event => void handlePurchaseAttachment(event.target.files?.[0])} className="py-2 file:me-3 file:min-h-10 file:rounded-ds-sm file:border-0 file:bg-ds-surface-2 file:px-3 file:font-bold" />
                  {purchaseAttachment && <p className="text-sm font-semibold text-ds-success">{invoiceT('ui.attachedImage', { name: purchaseAttachment.fileName })}</p>}
                  {purchaseFileLoading && <p className="text-sm text-ds-muted">{invoiceT('ui.compressing')}</p>}
                </div>
              </div>
              {purchaseError && <p role="alert" className="rounded-ds-md bg-ds-danger-soft p-3 text-sm font-semibold text-ds-danger">{purchaseError}</p>}
            </div>
            <footer className="flex flex-col-reverse justify-end gap-2 border-t border-ds-border p-4 sm:flex-row sm:p-5">
              <Button type="button" variant="secondary" onClick={() => setIsPurchaseModalOpen(false)} disabled={purchaseSaving}>{invoiceT('ui.close')}</Button>
              <Button type="submit" disabled={purchaseSaving || purchaseFileLoading || (purchasePaidMilli > 0 && !cashSession)}>
                <Wallet className="h-4 w-4" /> {purchaseSaving ? 'Enregistrement…' : 'Enregistrer et recevoir le stock'}
              </Button>
            </footer>
          </form>
        </div>
      )}

      {selectedPurchase && isStoreAdmin && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-3 sm:p-5" role="presentation">
          <section role="dialog" aria-modal="true" aria-labelledby="purchase-detail-title" className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-ds-lg border border-ds-border bg-ds-surface shadow-ds-md">
            <header className="flex items-start justify-between gap-4 border-b border-ds-border p-5">
              <div>
                <h2 id="purchase-detail-title" className="text-xl font-black text-ds-text">{invoiceT('ui.purchaseDetail', { number: selectedPurchase.number || selectedPurchase.invoiceNumber })}</h2>
                  <p className="mt-1 text-sm text-ds-muted">{selectedPurchase.supplierName || invoiceT('ui.supplier')} · {toInvoiceDate(selectedPurchase.date) ? formatDateTime(toInvoiceDate(selectedPurchase.date)!, { dateStyle: 'medium' }) : invoiceT('ui.unknownDate')}</p>
              </div>
                <Button type="button" variant="ghost" onClick={() => { setSelectedPurchase(null); setShowPurchaseCancelConfirm(false); setPurchaseError(''); }} aria-label={invoiceT('ui.close')}><X className="h-5 w-5" /></Button>
            </header>
            <div className="space-y-4 overflow-y-auto p-5">
              <div className="grid gap-3 sm:grid-cols-3">
                <Card className="bg-ds-surface-2 p-3"><p className="text-[10px] font-bold uppercase text-ds-muted">{invoiceT('ui.total')}</p><p className="mt-1 font-mono font-black text-ds-text">{((Number(selectedPurchase.totalMilli) || 0) / 1000).toFixed(3)} DT</p></Card>
                <Card className="bg-ds-success-soft p-3"><p className="text-[10px] font-bold uppercase text-ds-success">{invoiceT('ui.paid')}</p><p className="mt-1 font-mono font-black text-ds-success">{((Number(selectedPurchase.paidMilli) || 0) / 1000).toFixed(3)} DT</p></Card>
                <Card className="bg-ds-warning-soft p-3"><p className="text-[10px] font-bold uppercase text-ds-warning">{invoiceT('ui.due')}</p><p className="mt-1 font-mono font-black text-ds-warning">{((Number(selectedPurchase.debtMilli) || 0) / 1000).toFixed(3)} DT</p></Card>
              </div>

              <div className="overflow-x-auto rounded-ds-md border border-ds-border">
                <table className="w-full min-w-[400px] text-start text-sm">
                  <thead className="bg-ds-surface-2 text-[10px] uppercase text-ds-muted"><tr><th className="p-3">{invoiceT('ui.item')}</th><th>{invoiceT('ui.quantity')}</th><th className="text-end">{invoiceT('ui.unitCost')}</th></tr></thead>
                  <tbody className="divide-y divide-ds-border text-ds-text">
                    {(selectedPurchase.items || []).map((line, index) => <tr key={`${line.itemCollection}:${line.itemId}:${index}`}><td className="p-3 font-semibold">{line.nameSnapshot}</td><td>{line.quantity}</td><td className="p-3 text-end font-mono">{(line.unitCostMilli / 1000).toFixed(3)} DT</td></tr>)}
                  </tbody>
                </table>
              </div>
              {selectedPurchase.note && <p className="whitespace-pre-wrap rounded-ds-md bg-ds-surface-2 p-3 text-sm text-ds-text">{selectedPurchase.note}</p>}
              {selectedPurchase.attachment?.url && <a href={selectedPurchase.attachment.url} target="_blank" rel="noreferrer" className="text-sm font-bold text-ds-info underline">{invoiceT('ui.openAttachment')}</a>}
              {selectedPurchase.attachment?.dataUrl && <a href={selectedPurchase.attachment.dataUrl} target="_blank" rel="noreferrer" className="block"><img src={selectedPurchase.attachment.dataUrl} alt={`${invoiceT('ui.attachment')} ${selectedPurchase.number}`} className="max-h-56 rounded-ds-md border border-ds-border object-contain" /></a>}

              {selectedPurchase.status === 'received' && Number(selectedPurchase.debtMilli) > 0 && (
                <div className="space-y-3 rounded-ds-lg border border-ds-warning/20 bg-ds-warning-soft p-4">
                  <h3 className="text-sm font-black text-ds-text">{invoiceT('ui.settleSupplierDebt')}</h3>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input type="number" min="0.001" step="0.001" max={(Number(selectedPurchase.debtMilli) || 0) / 1000} value={supplierPaymentAmount} onChange={event => setSupplierPaymentAmount(event.target.value)} placeholder={invoiceT('ui.amountInDt')} className="flex-1 font-mono" />
                    <Button type="button" onClick={() => void payPurchaseDebt()} disabled={paymentSaving || !cashSession || !supplierPaymentAmount}>{invoiceT('ui.settle')}</Button>
                  </div>
                  {!cashSession && <p className="text-sm font-semibold text-ds-warning">{cashSessionLoading ? invoiceT('ui.cashChecking') : invoiceT('ui.cashRequired')}</p>}
                </div>
              )}

              <section>
                <h3 className="mb-2 text-sm font-black text-ds-text">{invoiceT('ui.paymentHistory')}</h3>
                {supplierPayments.length === 0 ? <p className="text-sm text-ds-muted">{invoiceT('ui.noPaymentHistory')}</p> : (
                  <ul className="divide-y divide-ds-border rounded-ds-md border border-ds-border">
                    {supplierPayments.map(payment => {
                      const date = toInvoiceDate(payment.createdAt);
                      const amount = (Number(payment.amountMilli) || 0) / 1000;
                      return <li key={payment.id} className="flex flex-wrap justify-between gap-2 p-3 text-xs">
                        <span className="text-ds-text-muted">{date ? formatDateTime(date, { dateStyle: 'short', timeStyle: 'short' }) : invoiceT('ui.unknownDate')} · {payment.type === 'purchase_cancellation_credit' ? invoiceT('ui.cancellationCredit') : payment.type === 'purchase_initial_payment' ? invoiceT('ui.initialPayment') : invoiceT('ui.payment')}</span>
                        <strong className={`font-mono ${amount < 0 ? 'text-ds-warning' : 'text-ds-success'}`}>{amount < 0 ? '+' : '−'}{Math.abs(amount).toFixed(3)} DT</strong>
                      </li>;
                    })}
                  </ul>
                )}
              </section>

              {selectedPurchase.status === 'received' && <div className="space-y-3 border-t border-ds-border pt-4">
                {!showPurchaseCancelConfirm ? (
                  <Button type="button" variant="danger" onClick={() => { setShowPurchaseCancelConfirm(true); setPurchaseError(''); }}><Ban className="h-4 w-4" /> {invoiceT('ui.cancelInvoice')}</Button>
                ) : (
                  <div className="space-y-3 rounded-ds-lg border border-ds-danger/20 bg-ds-danger-soft p-4">
                    <p className="text-sm font-bold text-ds-danger">{invoiceT('ui.confirmCancellation')}</p>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="danger" onClick={() => void cancelPurchaseInvoice()} disabled={paymentSaving}>{paymentSaving ? invoiceT('ui.cancelling') : invoiceT('ui.confirmCancel')}</Button>
                      <Button type="button" variant="secondary" onClick={() => setShowPurchaseCancelConfirm(false)} disabled={paymentSaving}>{invoiceT('ui.back')}</Button>
                    </div>
                  </div>
                )}
              </div>}
              {selectedPurchase.status === 'cancelled' && <Badge variant="danger" className="w-full justify-start rounded-ds-md">{invoiceT('ui.invoiceCancelled')} {selectedPurchase.cancellationReason}</Badge>}
              {purchaseError && <p role="alert" className="rounded-ds-md bg-ds-danger-soft p-3 text-sm font-semibold text-ds-danger">{purchaseError}</p>}
            </div>
          </section>
        </div>
      )}

      {/* New Invoice Modal */}
      {isNewInvoiceModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-2 backdrop-blur-sm animate-in fade-in duration-200 sm:p-4">
          <div className="flex h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-ds-lg border border-ds-border bg-ds-surface shadow-ds-md sm:h-[90vh]">
            <div className="flex items-center justify-between border-b border-ds-border bg-ds-surface-2 px-5 py-4 sm:px-8 sm:py-6">
              <div className="flex items-center gap-2.5">
                <div className="rounded-ds-md bg-ds-brand-soft p-2 text-ds-brand">
                  <Plus className="w-4.5 h-4.5 sm:w-6 sm:h-6" />
                </div>
                <div>
                  <h2 className="text-base font-black leading-tight text-ds-text sm:text-xl">{invoiceT('ui.newInvoice')}</h2>
                  <p className="mt-0.5 text-xs font-medium uppercase tracking-wider text-ds-muted">{invoiceT('ui.manualInvoice')}</p>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setIsNewInvoiceModalOpen(false)} aria-label={invoiceT('ui.close')}>
                <X className="w-5 h-5 sm:w-6 sm:h-6" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto md:overflow-hidden flex flex-col md:flex-row">
              {/* Left Side: Product Selection */}
              <div className="flex min-w-0 flex-1 flex-col border-b border-ds-border bg-ds-surface-2 md:border-b-0 md:border-e">
                <div className="p-4 sm:p-6 space-y-4">
                  <div className="relative">
                    <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-5 h-5 text-ds-muted" />
                    <Input
                      type="text"
                      placeholder={invoiceT('ui.productSearch')}
                      className="ps-10 pe-4"
                      value={productSearch}
                      onChange={(e) => setProductSearch(e.target.value)}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2.5 sm:gap-3 overflow-y-auto max-h-[35vh] md:max-h-[50vh] pe-1 sm:pe-2">
                    {filteredProducts.map(product => (
                      <button
                        key={product.id}
                        onClick={() => addToCart(product)}
                        disabled={product.stock <= 0}
                        className={cn(
                          "group relative flex h-[125px] w-full min-w-0 cursor-pointer flex-col justify-between overflow-hidden rounded-ds-md border p-2.5 text-start transition-all sm:h-[130px] sm:p-3",
                          product.stock > 0 
                            ? "border-ds-border bg-ds-surface hover:border-ds-brand hover:shadow-ds-sm active:scale-95"
                            : "border-ds-border bg-ds-surface-2 opacity-60 grayscale cursor-not-allowed"
                        )}
                      >
                        <div className="flex-1 flex items-start min-w-0 w-full mb-1">
                          <div 
                            className="w-full overflow-hidden break-words text-[11px] font-extrabold leading-tight text-ds-text line-clamp-2 text-ellipsis whitespace-normal group-hover:text-ds-brand sm:text-xs sm:leading-snug"
                            style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}
                          >
                            {product.name}
                          </div>
                        </div>
                        <div className="mt-auto flex w-full shrink-0 flex-col gap-0.5 border-t border-ds-border pt-1.5 leading-tight">
                          <div className="truncate text-[11px] font-bold font-mono text-ds-text-muted sm:text-xs">
                            {product.sellPrice.toFixed(3)} {storeSettings?.currency || 'DT'}
                          </div>
                          <div className={cn(
                            "text-[8px] font-extrabold uppercase tracking-wider sm:text-[10px]",
                            product.stock <= (product.lowStockAlert || 5) ? "text-ds-warning" : "text-ds-success"
                          )}>
                            {invoiceT('ui.stockCount', { count: product.stock })}
                          </div>
                        </div>
                        {product.stock <= 0 && (
                          <div className="absolute inset-0 flex items-center justify-center bg-ds-surface/70 p-1 text-center backdrop-blur-[1px]">
                            <Badge variant="danger" className="min-h-0 rounded px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider sm:text-[9px]">
                              {invoiceT('ui.outOfStock')}
                            </Badge>
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Right Side: Cart & Client */}
              <div className="flex w-full min-w-0 flex-col bg-ds-surface md:w-[400px]">
                <div className="space-y-4 border-b border-ds-border p-4 sm:p-6">
                  <div>
                    <Select
                      label={invoiceT('ui.client')}
                      value={selectedClient?.id || ''}
                      onChange={(e) => {
                        const client = clients.find(c => c.id === e.target.value);
                        setSelectedClient(client || null);
                        if (!client) {
                          setPaidAmount(cartTotal);
                          setPaidAmountInput(cartTotal.toFixed(3));
                        }
                      }}
                    >
                      <option value="">{invoiceT('ui.walkInCustomer')}</option>
                      {clients.map(client => (
                        <option key={client.id} value={client.id}>
                          {client.name} {client.code ? `(${client.code})` : ''}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
                  <label className="text-xs font-semibold uppercase tracking-wider text-ds-muted">{invoiceT('ui.articles')}</label>
                  {cart.length === 0 ? (
                    <EmptyState title={invoiceT('ui.emptyCart')} className="py-8" />
                  ) : (
                    <div className="space-y-3">
                      {cart.map(item => (
                        <div key={item.productId} className="flex items-center justify-between rounded-ds-md border border-ds-border bg-ds-surface-2 p-3">
                          <div className="flex-1 min-w-0 pe-4">
                            <div className="truncate text-xs font-extrabold text-ds-text">{item.name}</div>
                            <div className="mt-0.5 text-[10px] font-mono text-ds-muted">{item.price.toFixed(3)} {storeSettings?.currency || 'DT'} x {item.quantity}</div>
                          </div>
                          <div className="flex items-center gap-1.5 sm:gap-2">
                            <Button variant="secondary" size="sm" aria-label={invoiceT('ui.decreaseQuantity')} onClick={() => updateQuantity(item.productId, -1)} className="min-h-11 w-11 p-0">
                              <Minus className="w-3.5 h-3.5" />
                            </Button>
                            <span className="w-5 text-center font-bold text-xs">{item.quantity}</span>
                            <Button variant="secondary" size="sm" aria-label={invoiceT('ui.increaseQuantity')} onClick={() => updateQuantity(item.productId, 1)} className="min-h-11 w-11 p-0">
                              <Plus className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="ghost" size="sm" aria-label={invoiceT('ui.removeFromCart')} onClick={() => removeFromCart(item.productId)} className="ms-1 min-h-11 w-11 p-0 text-ds-danger">
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-4 border-t border-ds-border bg-ds-surface-2 p-4 sm:p-6">
                  <div className="space-y-1.5">
                    {storeSettings?.tvaEnabled === true && (
                      <div className="flex justify-between text-xs sm:text-sm">
                        <span className="font-semibold text-ds-muted">{invoiceT('ui.subtotal')}</span>
                        <span className="font-mono font-bold">{subtotal.toFixed(3)} {storeSettings?.currency || 'DT'}</span>
                      </div>
                    )}
                    {storeSettings?.tvaEnabled === true && (
                      <div className="flex justify-between text-xs sm:text-sm">
                        <span className="font-semibold text-ds-muted">{invoiceT('ui.vat', { rate: storeSettings?.tva || 0 })}</span>
                        <span className="font-mono font-bold">{tvaAmount.toFixed(3)} {storeSettings?.currency || 'DT'}</span>
                      </div>
                    )}
                    <div className="flex justify-between border-t border-ds-border pt-1.5 text-base sm:text-lg">
                      <span className="font-black text-ds-text">{invoiceT('ui.grandTotal')}</span>
                      <span className="font-black text-ds-brand font-mono">{cartTotal.toFixed(3)} {storeSettings?.currency || 'DT'}</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Input
                      label={invoiceT('ui.paidAmount')}
                      type="text"
                      inputMode="decimal"
                      className="font-mono font-black"
                      value={paidAmountInput}
                      onFocus={() => setIsPaidFocused(true)}
                      onBlur={() => {
                        setIsPaidFocused(false);
                        const parsed = parseFloat(paidAmountInput) || 0;
                        const rounded = Math.round(parsed * 1000) / 1000;
                        setPaidAmountInput(rounded === 0 ? '' : rounded.toFixed(3));
                        setPaidAmount(rounded);
                      }}
                      onChange={(e) => {
                        const value = e.target.value.replace(',', '.');
                        if (value === '' || /^\d*\.?\d*$/.test(value)) {
                          setPaidAmountInput(value);
                          const parsed = parseFloat(value) || 0;
                          setPaidAmount(Math.round(parsed * 1000) / 1000);
                        }
                      }}
                      placeholder="0.000"
                    />
                  </div>

                  {/* Reste à payer / Dette */}
                  <Badge variant={remainingDebt > 0 ? 'warning' : 'success'} className="w-full justify-between rounded-ds-md font-mono text-sm">
                    <span className="font-sans text-xs font-semibold uppercase tracking-wider">{invoiceT('ui.remaining')}</span>
                    {remainingDebt.toFixed(3)} {storeSettings?.currency || 'DT'}
                  </Badge>

                  {/* Warning de paiement pour client passager */}
                  {!selectedClient && Math.abs(paidAmount - cartTotal) > 0.001 && (
                    <div className="flex items-center gap-1.5 rounded-ds-md border border-ds-danger/20 bg-ds-danger-soft p-3 text-sm font-semibold text-ds-danger animate-in fade-in duration-200">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{invoiceT('ui.walkInPaymentWarning', { amount: cartTotal.toFixed(3), currency: storeSettings?.currency || 'DT' })}</span>
                    </div>
                  )}

                  {error && (
                    <div className="flex items-center gap-2 rounded-ds-md border border-ds-danger/20 bg-ds-danger-soft p-3 text-ds-danger">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span className="text-xs font-bold">{error}</span>
                      {!cashSession && !cashSessionLoading && <Button type="button" variant="danger" onClick={() => navigate('/cash-session')} className="ms-auto">{invoiceT('ui.openCash')}</Button>}
                    </div>
                  )}

                  <Button
                    type="button"
                    onClick={validateSale}
                    disabled={isProcessing || cart.length === 0}
                    className="w-full"
                  >
                    {isProcessing ? (
                      <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <>
                        <CheckCircle2 className="w-5 h-5" />
                        {invoiceT('ui.validateInvoice')}
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Success Toast */}
      {saleSuccess && (
        <div className="fixed bottom-8 end-8 z-[100] animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="flex items-center gap-3 rounded-ds-lg border border-ds-success bg-ds-success px-6 py-4 text-ds-brand-contrast shadow-ds-md">
            <div className="rounded-ds-sm bg-white/15 p-1.5">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <span className="font-bold">{saleSuccess}</span>
          </div>
        </div>
      )}

      {/* Invoice Detail Modal */}
      {selectedInvoice && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-2 sm:p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-ds-lg border border-ds-border bg-ds-surface shadow-ds-md sm:max-h-[90vh]">
            <div className="flex items-center justify-between border-b border-ds-border bg-ds-surface-2 px-5 py-4 sm:px-8 sm:py-6">
              <div>
                <h2 className="text-base font-black text-ds-text sm:text-lg">{invoiceT('ui.invoiceDetail', { number: selectedInvoice.number })}</h2>
                <p className="mt-1 text-xs font-mono uppercase tracking-widest text-ds-muted">{invoiceT('ui.invoiceDate', { date: selectedInvoice.date?.toDate ? formatDateTime(selectedInvoice.date.toDate(), { dateStyle: 'long', timeStyle: 'short' }) : invoiceT('ui.unknownDate') })}</p>
                {userProfile?.role === 'admin' && (selectedInvoice.createdBy || selectedInvoice.updatedBy) && (
                  <p className="mt-1 text-[10px] text-ds-muted">
                    {selectedInvoice.createdBy && <>{invoiceT('ui.audit.createdBy', { name: auditName(selectedInvoice.createdBy) })}{auditDate(selectedInvoice.date, getDateLocale()) && ` ${invoiceT('ui.audit.on', { date: auditDate(selectedInvoice.date, getDateLocale()) })}`}</>}
                    {selectedInvoice.updatedBy && <> · {invoiceT('ui.audit.updatedBy', { name: auditName(selectedInvoice.updatedBy) })}{auditDate(selectedInvoice.updatedAt, getDateLocale()) && ` ${invoiceT('ui.audit.on', { date: auditDate(selectedInvoice.updatedAt, getDateLocale()) })}`}</>}
                  </p>
                )}
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelectedInvoice(null)} aria-label={invoiceT('ui.close')}>
                <X className="w-5 h-5 sm:w-6 sm:h-6" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-8 space-y-5 sm:space-y-8">
              <div className="grid grid-cols-2 gap-4 sm:gap-8">
                <div className="space-y-1">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-ds-muted">{invoiceT('ui.client')}</label>
                  <div className="text-xs font-extrabold text-ds-text sm:text-sm">{selectedInvoice.clientName}</div>
                  {selectedInvoice.clientCode && <div className="text-xs font-mono text-ds-muted">{invoiceT('ui.code')}: {selectedInvoice.clientCode}</div>}
                  {selectedInvoice.clientPhone && <div className="text-xs text-ds-muted">{selectedInvoice.clientPhone}</div>}
                  {selectedInvoice.clientAddress && <div className="max-w-[120px] truncate text-xs italic text-ds-muted sm:max-w-none">{selectedInvoice.clientAddress}</div>}
                </div>
                <div className="space-y-1 text-end">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-ds-muted">{invoiceT('ui.store')}</label>
                  <div className="text-xs font-bold text-ds-brand sm:text-sm">{storeSettings?.storeName || brand.storeName}</div>
                  <div className="text-xs text-ds-muted">{storeSettings?.address || invoiceT('ui.addressDefault')}</div>
                  {storeSettings?.phone && <div className="text-xs text-ds-muted">{storeSettings.phone}</div>}
                </div>
              </div>

              <div className="space-y-4">
                <div className="overflow-x-auto rounded-ds-md border border-ds-border bg-ds-surface-2">
                  <table className="w-full text-start border-collapse min-w-[380px] sm:min-w-0">
                    <thead>
                      <tr className="border-b border-ds-border text-[10px] font-bold uppercase tracking-widest text-ds-muted">
                        <th className="px-4 py-2.5 sm:px-6 sm:py-3">{invoiceT('ui.product')}</th>
                        <th className="px-4 py-2.5 sm:px-6 sm:py-3 text-center">{invoiceT('ui.quantity')}</th>
                        <th className="px-4 py-2.5 sm:px-6 sm:py-3 text-end">{invoiceT('ui.price')}</th>
                        <th className="px-4 py-2.5 sm:px-6 sm:py-3 text-end">{invoiceT('ui.total')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ds-border">
                      {selectedInvoice.items.map((item, idx) => (
                        <tr key={idx} className="text-xs sm:text-sm">
                          <td className="px-4 py-2.5 font-bold text-ds-text sm:px-6 sm:py-3">
                            {item.name}
                            {formatProductDetails(item.attributes, item.serialNumber) && <div className="mt-1 text-[10px] font-normal text-ds-muted">{formatProductDetails(item.attributes, item.serialNumber)}</div>}
                          </td>
                          <td className="px-4 py-2.5 sm:px-6 sm:py-3 text-center font-mono">{item.quantity}</td>
                          <td className="px-4 py-2.5 sm:px-6 sm:py-3 text-end font-mono">{item.price.toFixed(3)}</td>
                          <td className="px-4 py-2.5 text-end font-mono font-black text-ds-brand sm:px-6 sm:py-3">{item.total.toFixed(3)} {storeSettings?.currency || 'DT'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <Card className="space-y-3 bg-ds-surface-2 p-5 sm:space-y-4 sm:p-8">
                {selectedInvoice.tvaEnabled === true && selectedInvoice.tva > 0 && (
                  <div className="flex justify-between items-center opacity-70">
                    <span className="text-xs uppercase tracking-widest font-bold">{invoiceT('ui.subtotal')}</span>
                    <span className="font-mono text-xs sm:text-sm">{(selectedInvoice.subtotal ?? selectedInvoice.total - selectedInvoice.tva).toFixed(3)} {storeSettings?.currency || 'DT'}</span>
                  </div>
                )}
                {selectedInvoice.tvaEnabled === true && selectedInvoice.tva > 0 && (
                  <div className="flex justify-between items-center opacity-70">
                    <span className="text-xs uppercase tracking-widest font-bold">{invoiceT('ui.vat', { rate: storeSettings?.tva || 0 })}</span>
                    <span className="font-mono text-xs sm:text-sm">{selectedInvoice.tva.toFixed(3)} {storeSettings?.currency || 'DT'}</span>
                  </div>
                )}
                <div className="flex justify-between items-center pt-2 border-t border-white/10">
                  <span className="text-xs uppercase tracking-widest font-bold">{invoiceT('ui.generalTotal')}</span>
                  <span className="text-base font-black font-mono text-ds-brand sm:text-2xl">{selectedInvoice.total.toFixed(3)} {storeSettings?.currency || 'DT'}</span>
                </div>
                <div className="flex justify-between items-center opacity-70">
                  <span className="text-xs uppercase tracking-widest font-bold">{invoiceT('ui.paid')}</span>
                  <span className="font-mono text-xs sm:text-sm">{selectedInvoice.paid.toFixed(3)} {storeSettings?.currency || 'DT'}</span>
                </div>
                {selectedInvoice.debt > 0 && (
                  <div className="flex justify-between items-center border-t border-ds-border pt-2 text-ds-warning">
                    <span className="text-xs font-bold uppercase tracking-widest">{invoiceT('ui.remaining')}</span>
                    <span className="text-base sm:text-xl font-black font-mono">{selectedInvoice.debt.toFixed(3)} {storeSettings?.currency || 'DT'}</span>
                  </div>
                )}
              </Card>
            </div>

            <div className="flex flex-col gap-3 border-t border-ds-border bg-ds-surface-2 p-4 sm:flex-row sm:gap-4 sm:p-8">
              <Button
                onClick={() => downloadPDF(selectedInvoice)}
                className="flex-1"
              >
                <Download className="w-4 h-4 sm:w-5 sm:h-5 font-black" />
                {invoiceT('ui.downloadPdf')}
              </Button>
              <Button type="button" variant="secondary"
                onClick={handlePrint}
                className="flex-1"
              >
                <Printer className="w-4 h-4 sm:w-5 sm:h-5 font-black" />
                {invoiceT('ui.print')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
