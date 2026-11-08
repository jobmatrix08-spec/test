import React, { useState, useEffect, useRef } from 'react';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, setDoc, getDocs, where, getDocFromServer, deleteField, writeBatch, runTransaction } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { Product, Category, StoreSettings, UserProfile } from '../types';
import { handleFirestoreError, OperationType } from '../App';
import { Plus, Minus, Search, Edit2, Trash2, X, AlertTriangle, Package, Tag, Barcode, Shield, Eye, EyeOff, AlertCircle, History, Loader2, ArrowDown, ArrowUp } from 'lucide-react';
import { cn, decodeAzertyBarcode } from '../lib/utils';
import { can } from '../lib/permissions';
import { slugifyAppName } from '../lib/brand';
import { useBrand } from './BrandProvider';
import { Badge, Button, Card, EmptyState, Input, PageHeader, Select } from './ui';

interface ProductsProps {
  userProfile: UserProfile | null;
}

const EAN13_L_PATTERNS = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const EAN13_G_PATTERNS = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const EAN13_R_PATTERNS = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const EAN13_PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

function normalizeEan13(value: string): string | null {
  if (!/^\d{12,13}$/.test(value)) return null;
  const digits = value.slice(0, 12).split('').map(Number);
  const checkDigit = (10 - digits.reduce((sum, digit, index) => sum + digit * (index % 2 === 0 ? 1 : 3), 0) % 10) % 10;
  if (value.length === 13 && Number(value[12]) !== checkDigit) return null;
  return `${value.slice(0, 12)}${checkDigit}`;
}

function ean13Svg(value: string): string {
  const firstDigit = Number(value[0]);
  const left = value.slice(1, 7).split('').map((digit, index) =>
    EAN13_PARITY[firstDigit][index] === 'L' ? EAN13_L_PATTERNS[Number(digit)] : EAN13_G_PATTERNS[Number(digit)]
  ).join('');
  const right = value.slice(7).split('').map(digit => EAN13_R_PATTERNS[Number(digit)]).join('');
  const bits = `101${left}01010${right}101`;
  const bars = [...bits].flatMap((bit, index) => bit === '1'
    ? [`<rect x="${index}" y="0" width="1" height="${index < 3 || (index >= 45 && index < 50) || index >= 92 ? 56 : 50}"/>`]
    : []).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 95 60" role="img" aria-label="${value}"><rect width="95" height="60" fill="white"/><g fill="black">${bars}</g></svg>`;
}

export default function Products({ userProfile }: ProductsProps) {
  const brand = useBrand();
  const ownerId = (userProfile?.role === 'admin' ? userProfile?.uid : userProfile?.ownerId) || userProfile?.uid || auth.currentUser?.uid;
  const isAdmin = userProfile?.role === 'admin';
  const canViewBuyPrice = can(userProfile, 'products', 'viewBuyPrice');
  const canEditSellPrice = can(userProfile, 'products', 'editSellPrice');
  const canAddEdit = can(userProfile, 'products', 'addEdit');
  const canAdjustStock = can(userProfile, 'products', 'adjustStock');
  const canDelete = can(userProfile, 'products', 'delete');
  const canManage = canAddEdit || canAdjustStock || canDelete;
  const canManageItems = canAddEdit || canDelete;
  const [products, setProducts] = useState<Product[]>([]);
  const [productCosts, setProductCosts] = useState<Record<string, number>>({});
  const productCostsRef = useRef<Record<string, number>>({});
  const [legacyProductPrices, setLegacyProductPrices] = useState<Record<string, number>>({});
  const [productCostsLoaded, setProductCostsLoaded] = useState(false);
  const [migrationPreview, setMigrationPreview] = useState<Array<{ id: string; name: string; buyPrice: number }>>([]);
  const [migrationBackupDownloaded, setMigrationBackupDownloaded] = useState(false);
  const [migrationBusy, setMigrationBusy] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [storeSettings, setStoreSettings] = useState<StoreSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isQuickCategoryModalOpen, setIsQuickCategoryModalOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [scanStatus, setScanStatus] = useState<'idle' | 'scanned' | 'error'>('idle');
  const [scanMessage, setScanMessage] = useState('');
  const [deletingCatId, setDeletingCatId] = useState<string | null>(null);
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Empêche le double-clic sur "Enregistrer" / "Confirmer" (évite les ajouts en double)
  const [isSubmitting, setIsSubmitting] = useState(false);

  // States for security code modal (protects edit & delete)
  const [showSecurityModal, setShowSecurityModal] = useState(false);
  const [securityCode, setSecurityCode] = useState('');
  const [securityError, setSecurityError] = useState(false);
  const [showSecurityInput, setShowSecurityInput] = useState(false);
  const [pendingAction, setPendingAction] = useState<'edit' | 'delete' | null>(null);
  const [pendingProduct, setPendingProduct] = useState<Product | null>(null);

  // States for stock replenishment modal
  const [replenishProduct, setReplenishProduct] = useState<Product | null>(null);
  const [replenishQty, setReplenishQty] = useState<string>('');
  const [replenishPrice, setReplenishPrice] = useState<string>('');

  // States for stock history modal (diagnostic: entrées vs ventes vs stock affiché)
  const [historyProduct, setHistoryProduct] = useState<Product | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyMovements, setHistoryMovements] = useState<{ type: 'in' | 'out'; qty: number; date: Date | null; label: string }[]>([]);
  const [historyTotals, setHistoryTotals] = useState<{ totalIn: number; totalOut: number } | null>(null);

  const playBeep = (type: 'success' | 'error') => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      if (type === 'success') {
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = 950;
        gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.12);
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.12);
      } else {
        [0, 120].forEach((delay) => {
          setTimeout(() => {
            try {
              const osc = audioCtx.createOscillator();
              const gain = audioCtx.createGain();
              osc.type = 'sawtooth';
              osc.frequency.value = 180;
              gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
              gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
              osc.connect(gain);
              gain.connect(audioCtx.destination);
              osc.start();
              osc.stop(audioCtx.currentTime + 0.15);
            } catch (innerErr) {}
          }, delay);
        });
      }
    } catch (err) {}
  };

  useEffect(() => {
    if (!isModalOpen) {
      setScanStatus('idle');
      setScanMessage('');
      return;
    }

    let buffer = '';
    let lastKeyTime = 0;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key === 'Tab' || e.key === 'Escape' || e.key === 'ArrowUp' || e.key === 'ArrowDown') return;

      const now = Date.now();
      const target = e.target as HTMLElement;
      const isInputFocused = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
      const isBarcodeInputFocused = target && target.tagName === 'INPUT' && (target as HTMLInputElement).placeholder?.includes('douchette');

      const interval = lastKeyTime ? now - lastKeyTime : 0;
      lastKeyTime = now;

      if (e.key.length === 1) {
        if (isInputFocused && !isBarcodeInputFocused && interval > 120) {
          buffer = e.key;
          return;
        }

        if (interval > 120) {
          buffer = e.key;
        } else {
          buffer += e.key;
        }
      } else if (e.key === 'Enter') {
        const barcode = decodeAzertyBarcode(buffer.trim());
        buffer = '';
        lastKeyTime = 0;

        if (barcode.length >= 3) {
          playBeep('success');
          setFormData(prev => ({ ...prev, barcode }));
          setScanStatus('scanned');
          setScanMessage(`Code détecté avec succès : ${barcode}`);
          setTimeout(() => {
            setScanStatus('idle');
            setScanMessage('');
          }, 4500);

          e.preventDefault();
          e.stopPropagation();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isModalOpen]);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    category: '',
    buyPrice: 0,
    sellPrice: 0,
    reference: '',
    barcode: '',
    isService: false,
    stock: 0,
    expirationDate: '',
    lowStockAlert: 0
  });

  const [buyPriceInput, setBuyPriceInput] = useState('');
  const [sellPriceInput, setSellPriceInput] = useState('');

  useEffect(() => {
    if (!auth.currentUser || !ownerId) return;
    productCostsRef.current = {};
    const unsubscribeProds = onSnapshot(query(collection(db, 'products'), where('ownerId', '==', ownerId)), (snapshot) => {
      const prods = snapshot.docs.map(item => {
        const data = item.data();
        const { buyPrice: _storedBuyPrice, ...publicData } = data;
        const legacyBuyPrice = isAdmin ? Number(data.buyPrice) || 0 : 0;
        return { id: item.id, ...publicData, buyPrice: canViewBuyPrice ? (productCostsRef.current[item.id] ?? legacyBuyPrice) : 0 } as Product;
      });
      setLegacyProductPrices(Object.fromEntries(snapshot.docs
        .filter(item => isAdmin && Object.prototype.hasOwnProperty.call(item.data(), 'buyPrice'))
        .map(item => [item.id, Number(item.data().buyPrice) || 0])));
      prods.sort((a, b) => {
        const dateA = a.createdAt || '';
        const dateB = b.createdAt || '';
        if (dateA && dateB) {
          return dateB.localeCompare(dateA);
        }
        if (dateA) return -1;
        if (dateB) return 1;
        return (a.name || '').localeCompare(b.name || '');
      });
      setProducts(prods);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'products');
    });

    const unsubscribeCats = onSnapshot(query(collection(db, 'categories'), where('ownerId', '==', ownerId)), (snapshot) => {
      const cats = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Category));
      cats.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      setCategories(cats);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'categories');
    });

    const unsubscribeSettings = onSnapshot(doc(db, 'settings', ownerId), (snapshot) => {
      if (snapshot.exists()) {
        setStoreSettings(snapshot.data() as StoreSettings);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'settings');
    });

    const unsubscribeCosts = canViewBuyPrice
      ? onSnapshot(query(collection(db, 'product_costs'), where('ownerId', '==', ownerId)), snapshot => {
        const costMap = Object.fromEntries(snapshot.docs.map(item => [item.id, Number(item.data().buyPrice) || 0]));
        productCostsRef.current = costMap;
        setProductCosts(costMap);
        setProductCostsLoaded(true);
        setProducts(current => current.map(product => ({
          ...product,
          buyPrice: costMap[product.id] ?? product.buyPrice,
        })));
      }, error => {
        setProductCostsLoaded(true);
        handleFirestoreError(error, OperationType.LIST, 'product_costs');
      })
      : () => {
        productCostsRef.current = {};
        setProductCosts({});
        setProductCostsLoaded(false);
      };

    return () => {
      unsubscribeProds();
      unsubscribeCats();
      unsubscribeSettings();
      unsubscribeCosts();
    };
  }, [ownerId, isAdmin, canViewBuyPrice]);

  // Vérifie une VRAIE connexion serveur avant toute écriture.
  // getDocFromServer force une lecture réseau : hors-ligne (ou faux navigator.onLine),
  // elle échoue → on n'écrit rien, donc aucune opération n'est mise en file ni rejouée.
  const ensureOnline = async (timeoutMs = 8000): Promise<void> => {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('OFFLINE')), timeoutMs);
    });
    try {
      // Lecture serveur d'un doc léger (le compteur du propriétaire). Peu importe qu'il existe.
      await Promise.race([
        getDocFromServer(doc(db, 'counters', `invoices_${ownerId}`)),
        timeout,
      ]);
    } catch {
      throw new Error('OFFLINE');
    } finally {
      clearTimeout(timer!);
    }
  };

  const previewProductCostMigration = () => {
    if (!isAdmin || !productCostsLoaded) return;
    const preview = products
      .filter(product => Object.prototype.hasOwnProperty.call(legacyProductPrices, product.id))
      .map(product => ({
        id: product.id,
        name: product.name,
        buyPrice: productCosts[product.id] ?? legacyProductPrices[product.id] ?? 0,
      }));
    setMigrationPreview(preview);
    setMigrationBackupDownloaded(false);
    setErrorMsg(null);
  };

  const downloadProductCostBackup = () => {
    const backup = migrationPreview.map(item => ({
      ...products.find(product => product.id === item.id),
      buyPrice: item.buyPrice,
    }));
    const blob = new Blob([JSON.stringify({
      createdAt: new Date().toISOString(),
      ownerId,
      products: backup,
    }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${slugifyAppName(brand.storeName)}-products-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMigrationBackupDownloaded(true);
  };

  const confirmProductCostMigration = async () => {
    if (!isAdmin || !migrationBackupDownloaded || migrationBusy || migrationPreview.length === 0) return;
    setMigrationBusy(true);
    setErrorMsg(null);
    try {
      for (let offset = 0; offset < migrationPreview.length; offset += 200) {
        const batch = writeBatch(db);
        const page = migrationPreview.slice(offset, offset + 200);
        page.forEach(item => {
          const productRef = doc(db, 'products', item.id);
          batch.update(productRef, { buyPrice: deleteField() });
          if (productCosts[item.id] === undefined) {
            batch.set(doc(db, 'product_costs', item.id), {
              ownerId,
              buyPrice: item.buyPrice,
            });
          }
        });
        await batch.commit();
      }
      setMigrationPreview([]);
      setMigrationBackupDownloaded(false);
    } catch (error) {
      console.error('[ERROR] Product cost migration failed:', error);
      setErrorMsg(error instanceof Error ? `Migration interrompue : ${error.message}` : `Migration interrompue : ${String(error)}`);
    } finally {
      setMigrationBusy(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    // Empêche un second envoi tant que le premier n'est pas terminé (évite les doublons)
    if (!canAddEdit || isSubmitting) return;

    // Garde-fou : le prix de vente doit être supérieur ou égal au prix d'achat,
    // sinon chaque vente de ce produit génère un bénéfice négatif.
    if (isAdmin && !formData.isService && (formData.sellPrice || 0) < (formData.buyPrice || 0)) {
      setErrorMsg(
        `Le prix de vente (${(formData.sellPrice || 0).toFixed(3)}) doit être supérieur ou égal au prix d'achat (${(formData.buyPrice || 0).toFixed(3)}). Vendre en dessous du prix d'achat génère une perte sur chaque vente.`
      );
      return;
    }
    if (editingProduct && formData.isService !== (editingProduct.inventoryType === 'service')) {
      setErrorMsg('Le type d’article ne peut pas être converti après sa création. Créez un nouvel article avec le type souhaité.');
      return;
    }
    try {
      setIsSubmitting(true);

      // Vérifie une vraie connexion serveur AVANT d'écrire. Hors-ligne → aucune écriture.
      await ensureOnline();
      const { buyPrice: enteredBuyPrice, isService, ...formFields } = formData;
      const buyPrice = isService ? 0 : enteredBuyPrice;
      const productData = {
        ...formFields,
        reference: formData.reference.trim(),
        inventoryType: isService ? 'service' : (editingProduct?.inventoryType === 'spare_part' ? 'spare_part' : 'product'),
        stock: isService ? 0 : formData.stock,
        lowStockAlert: isService ? 0 : formData.lowStockAlert,
      };

      if (editingProduct) {
        const oldStock = editingProduct.stock || 0;
        const newStock = parseInt(formData.stock.toString()) || 0;

        if (newStock !== oldStock) {
          throw new Error('Ajustez le stock avec les boutons + / − pour conserver l’historique des mouvements.');
        }
        if (isAdmin && !isService) {
          const suppliesSnapshot = await getDocs(query(
            collection(db, 'supplies'),
            where('ownerId', '==', ownerId),
            where('productId', '==', editingProduct.id)
          ));
          for (const supply of suppliesSnapshot.docs) {
            const quantity = Number(supply.data().quantity) || 0;
            await updateDoc(doc(db, 'supplies', supply.id), {
              productName: formData.name,
              buyPrice,
              totalCost: quantity * buyPrice,
              ownerId,
              userId: userProfile?.uid || ownerId
            });
          }
          await setDoc(doc(db, 'product_costs', editingProduct.id), { ownerId, buyPrice });
        }

        await updateDoc(doc(db, 'products', editingProduct.id), {
          ...productData,
          ...(isAdmin ? { buyPrice: deleteField() } : {}),
          ownerId,
          userId: userProfile?.uid || ownerId
        });

        // Log d'audit (optionnel — ne bloque pas l'opération)
        try {
          const logRef = doc(collection(db, 'audit_logs'));
          await setDoc(logRef, {
            action: 'UPDATE_PRODUCT',
            userEmail: userProfile?.email || 'unknown',
            userName: userProfile?.name || 'unknown',
            timestamp: new Date().toISOString(),
            productId: editingProduct.id,
            productName: formData.name,
            ownerId,
            userId: userProfile?.uid || ownerId
          });
        } catch (logErr) {
          console.warn('[AUDIT LOG] Failed:', logErr);
        }
      } else {
        const docRef = doc(collection(db, 'products'));
        const stockInt = parseInt(formData.stock.toString()) || 0;
        const movementRef = doc(db, 'stock_movements', `product_${docRef.id}_v1`);
        await runTransaction(db, async transaction => {
          transaction.set(docRef, {
            ...productData,
            stock: stockInt,
            stockVersion: stockInt > 0 ? 1 : 0,
            ...(stockInt > 0 ? { lastStockMovementId: movementRef.id } : {}),
            createdAt: new Date().toISOString(),
            ownerId,
            userId: userProfile?.uid || ownerId
          });
          if (isAdmin && !isService) transaction.set(doc(db, 'product_costs', docRef.id), { ownerId, buyPrice });
          if (stockInt > 0) transaction.set(movementRef, {
            type: 'product_initial_stock',
            inventoryCollection: 'products',
            productId: docRef.id,
            productName: formData.name,
            delta: stockInt,
            quantity: stockInt,
            version: 1,
            ownerId,
            userId: userProfile?.uid || ownerId,
            userLabel: userProfile?.name || userProfile?.email || 'Utilisateur',
            createdAt: new Date(),
          });
        });

        // Log d'audit (optionnel — ne bloque pas l'opération)
        try {
          const logRef = doc(collection(db, 'audit_logs'));
          await setDoc(logRef, {
            action: 'CREATE_PRODUCT',
            userEmail: userProfile?.email || 'unknown',
            userName: userProfile?.name || 'unknown',
            timestamp: new Date().toISOString(),
            productId: docRef.id,
            productName: formData.name,
            ownerId,
            userId: userProfile?.uid || ownerId
          });
        } catch (logErr) {
          console.warn('[AUDIT LOG] Failed:', logErr);
        }
        if (isAdmin && !isService && stockInt > 0) {
          const expenseAmount = stockInt * buyPrice;
          await addDoc(collection(db, 'supplies'), {
            productId: docRef.id,
            productName: formData.name,
            quantity: stockInt,
            buyPrice,
            totalCost: expenseAmount,
            date: new Date(),
            ownerId,
            userId: userProfile?.uid || ownerId
          });
        }
      }
      closeModal();
    } catch (error: any) {
      if (error?.message === 'OFFLINE') {
        setErrorMsg("Vérifiez votre connexion Internet.");
      } else {
        console.error("[ERROR] Failed to save product:", error);
        setErrorMsg(error?.message || String(error));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReplenishSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canAdjustStock || !replenishProduct || !replenishQty) return;

    // Empêche un second envoi tant que le premier n'est pas terminé (évite les doublons)
    if (isSubmitting) return;

    try {
      setIsSubmitting(true);

      // Vérifie une vraie connexion serveur AVANT d'écrire. Hors-ligne → aucune écriture.
      // Le verrou isSubmitting reste actif pendant toute la vérification : les reclics sont ignorés.
      await ensureOnline();

      const qty = parseInt(replenishQty) || 0;
      const price = isAdmin ? (parseFloat(replenishPrice) || 0) : 0;
      if (qty <= 0) return;
      const expenseAmount = qty * price;

      await runTransaction(db, async transaction => {
        const productRef = doc(db, 'products', replenishProduct.id);
        const current = await transaction.get(productRef);
        if (!current.exists()) throw new Error('Cet article n’existe plus.');
        const version = (Number(current.data().stockVersion) || 0) + 1;
        const movementRef = doc(db, 'stock_movements', `product_${replenishProduct.id}_v${version}`);
        transaction.update(productRef, {
          stock: (Number(current.data().stock) || 0) + qty,
          stockVersion: version,
          lastStockMovementId: movementRef.id,
          ownerId,
          userId: userProfile?.uid || ownerId,
        });
        transaction.set(movementRef, {
          type: 'product_restock',
          inventoryCollection: 'products',
          productId: replenishProduct.id,
          productName: replenishProduct.name,
          delta: qty,
          quantity: qty,
          version,
          ownerId,
          userId: userProfile?.uid || ownerId,
          userLabel: userProfile?.name || userProfile?.email || 'Utilisateur',
          createdAt: new Date(),
        });
      });

      if (isAdmin) {
        await setDoc(doc(db, 'product_costs', replenishProduct.id), { ownerId, buyPrice: price });
        await addDoc(collection(db, 'supplies'), {
          productId: replenishProduct.id,
          productName: replenishProduct.name,
          quantity: qty,
          buyPrice: price,
          totalCost: expenseAmount,
          date: new Date(),
          ownerId,
          userId: userProfile?.uid || ownerId
        });
      }

      // Track in custom offline queue if offline to count pending operations
      // (Bloc conservé sans effet : l'approvisionnement hors-ligne est désormais bloqué en amont.)

      setReplenishProduct(null);
      setReplenishQty('');
      setReplenishPrice('');
      playBeep('success');
    } catch (error: any) {
      playBeep('error');
      if (error?.message === 'OFFLINE') {
        alert("Vérifiez votre connexion Internet.");
      } else {
        console.error("[ERROR] Failed to replenish product stock:", error);
        alert("Échec de l'approvisionnement. Réessayez.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const adjustProductStock = async (product: Product, delta: number) => {
    if (!canAdjustStock || delta === 0) return;
    try {
      await runTransaction(db, async transaction => {
        const productRef = doc(db, 'products', product.id);
        const current = await transaction.get(productRef);
        if (!current.exists()) throw new Error('Cet article n’existe plus.');
        const stock = Number(current.data().stock) || 0;
        const nextStock = stock + delta;
        if (nextStock < 0) throw new Error('Le stock ne peut pas être négatif.');
        const version = (Number(current.data().stockVersion) || 0) + 1;
        const movementRef = doc(db, 'stock_movements', `product_${product.id}_v${version}`);
        transaction.update(productRef, {
          stock: nextStock,
          stockVersion: version,
          lastStockMovementId: movementRef.id,
          ownerId,
          userId: userProfile?.uid || ownerId,
        });
        transaction.set(movementRef, {
          type: 'product_manual_adjustment',
          inventoryCollection: 'products',
          productId: product.id,
          productName: product.name,
          delta,
          quantity: Math.abs(delta),
          version,
          ownerId,
          userId: userProfile?.uid || ownerId,
          userLabel: userProfile?.name || userProfile?.email || 'Technicien',
          createdAt: new Date(),
        });
      });
    } catch (error) {
      console.error('[ERROR] Product stock adjustment failed:', error);
      setErrorMsg(error instanceof Error ? error.message : String(error));
    }
  };

  // Charge l'historique de stock d'un produit : entrées (supplies) et sorties (ventes),
  // pour comparer le stock théorique (entrées - ventes) au stock affiché.
  const openHistory = async (product: Product) => {
    setHistoryProduct(product);
    setHistoryLoading(true);
    setHistoryError(null);
    setHistoryMovements([]);
    setHistoryTotals(null);

    const toDate = (d: any): Date | null => {
      if (!d) return null;
      if (d instanceof Date) return d;
      if (typeof d?.toDate === 'function') return d.toDate();
      if (typeof d?.seconds === 'number') return new Date(d.seconds * 1000);
      const parsed = new Date(d);
      return isNaN(parsed.getTime()) ? null : parsed;
    };

    try {
      const movements: { type: 'in' | 'out'; qty: number; date: Date | null; label: string }[] = [];
      let totalIn = 0;
      let totalOut = 0;

      if (isAdmin) {
        const suppliesSnap = await getDocs(query(
          collection(db, 'supplies'),
          where('ownerId', '==', ownerId),
          where('productId', '==', product.id)
        ));
        suppliesSnap.forEach(d => {
          const quantity = Number(d.data().quantity) || 0;
          totalIn += quantity;
          movements.push({ type: 'in', qty: quantity, date: toDate(d.data().date), label: 'Entrée / appro.' });
        });

        const salesSnap = await getDocs(query(collection(db, 'sales'), where('ownerId', '==', ownerId)));
        salesSnap.forEach(d => {
          const sale = d.data();
          if (!Array.isArray(sale.items)) return;
          for (const item of sale.items) {
            if (item.productId === product.id) {
              const quantity = Number(item.quantity) || 0;
              totalOut += quantity;
              movements.push({ type: 'out', qty: quantity, date: toDate(sale.date), label: 'Vente' });
            }
          }
        });
      } else {
        const stockMovements = await getDocs(query(
          collection(db, 'stock_movements'),
          where('ownerId', '==', ownerId),
          where('inventoryCollection', '==', 'products'),
          where('productId', '==', product.id)
        ));
        stockMovements.forEach(d => {
          const movement = d.data();
          const delta = Number(movement.delta) || 0;
          if (delta > 0) totalIn += delta;
          else totalOut += Math.abs(delta);
          movements.push({
            type: delta >= 0 ? 'in' : 'out',
            qty: Math.abs(delta),
            date: toDate(movement.createdAt),
            label: String(movement.type || 'Mouvement').replaceAll('_', ' '),
          });
        });
      }

      // Tri chronologique (les mouvements sans date en dernier)
      movements.sort((a, b) => {
        const ta = a.date ? a.date.getTime() : Infinity;
        const tb = b.date ? b.date.getTime() : Infinity;
        return ta - tb;
      });

      setHistoryMovements(movements);
      setHistoryTotals({ totalIn, totalOut });
    } catch (error: any) {
      console.error("[ERROR] Failed to load stock history:", error);
      setHistoryError(error?.message || String(error));
    } finally {
      setHistoryLoading(false);
    }
  };

  const executeProductDelete = async () => {
    if (!canDelete || !productToDelete) return;
    setErrorMsg(null);
    try {
      if (isAdmin) {
        const querySnapshot = await getDocs(query(
          collection(db, 'supplies'),
          where('ownerId', '==', ownerId),
          where('productId', '==', productToDelete.id)
        ));
        for (const supply of querySnapshot.docs) {
          await deleteDoc(doc(db, 'supplies', supply.id));
        }
      }

      await deleteDoc(doc(db, 'products', productToDelete.id));

      // Log d'audit (optionnel — ne bloque pas l'opération)
      try {
        const logRef = doc(collection(db, 'audit_logs'));
        await setDoc(logRef, {
          action: 'DELETE_PRODUCT',
          userEmail: userProfile?.email || 'unknown',
          userName: userProfile?.name || 'unknown',
          timestamp: new Date().toISOString(),
          productId: productToDelete.id,
          productName: productToDelete.name,
          ownerId,
          userId: userProfile?.uid || ownerId
        });
      } catch (logErr) {
        console.warn('[AUDIT LOG] Failed:', logErr);
      }

      setProductToDelete(null);
    } catch (error: any) {
      console.error("[ERROR] Failed to delete product:", error);
      setErrorMsg(error?.message || String(error));
    }
  };

  const executeCategoryDelete = async (categoryId: string, categoryName: string) => {
    if (!canDelete) return;
    try {
      await deleteDoc(doc(db, 'categories', categoryId));
      if (formData.category === categoryName) {
        const remaining = categories.filter(c => c.id !== categoryId);
        setFormData(prev => ({ ...prev, category: remaining[0]?.name || '' }));
      }
      setDeletingCatId(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'categories');
    }
  };

  const openModal = (product?: Product) => {
    setErrorMsg(null);
    if (product) {
      setEditingProduct(product);
      setFormData({
        name: product.name,
        category: product.category,
        buyPrice: isAdmin && product.inventoryType !== 'service' ? (productCosts[product.id] ?? product.buyPrice) : 0,
        sellPrice: product.sellPrice,
        reference: product.reference || '',
        barcode: product.barcode || '',
        isService: product.inventoryType === 'service',
        stock: product.stock,
        expirationDate: product.expirationDate || '',
        lowStockAlert: product.lowStockAlert || 5
      });
      setBuyPriceInput(isAdmin && product.inventoryType !== 'service' ? (productCosts[product.id] ?? product.buyPrice).toFixed(3) : '');
      setSellPriceInput(product.sellPrice.toFixed(3));
    } else {
      setEditingProduct(null);
      setFormData({
        name: '',
        category: categories[0]?.name || 'produit',
        buyPrice: 0,
        sellPrice: 0,
        reference: '',
        barcode: '',
        isService: false,
        stock: 0,
        expirationDate: '',
        lowStockAlert: 0
      });
      setBuyPriceInput('');
      setSellPriceInput('');
    }
    setIsModalOpen(true);
  };

  const printBarcode = () => {
    const ean13 = normalizeEan13(formData.barcode.trim());
    if (!ean13) {
      setErrorMsg('Pour imprimer une étiquette, saisissez ou générez un code EAN-13 valide.');
      return;
    }
    const printWindow = window.open('', '_blank', 'width=420,height=320');
    if (!printWindow) {
      setErrorMsg('La fenêtre d’impression a été bloquée par le navigateur.');
      return;
    }
    setFormData(current => ({ ...current, barcode: ean13 }));
    printWindow.document.open();
    printWindow.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Étiquette code-barres</title><style>@page{margin:8mm}body{font-family:Arial,sans-serif;text-align:center;margin:0;padding:12px}.label{width:70mm;margin:auto}.name{font-size:14px;font-weight:700;margin-bottom:5px;overflow-wrap:anywhere}svg{width:100%;height:44mm}.code{font-family:monospace;font-size:13px;letter-spacing:2px;margin-top:2px}@media screen{body{padding:24px}}</style></head><body><main class="label"><div class="name"></div></main></body></html>');
    const nameElement = printWindow.document.querySelector('.name');
    if (nameElement) nameElement.textContent = formData.name || 'Article';
    const label = printWindow.document.querySelector('.label');
    if (label) {
      label.insertAdjacentHTML('beforeend', ean13Svg(ean13));
      const code = printWindow.document.createElement('div');
      code.className = 'code';
      code.textContent = ean13;
      label.append(code);
    }
    printWindow.document.close();
    printWindow.onafterprint = () => printWindow.close();
    printWindow.setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 250);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingProduct(null);
    setErrorMsg(null);
  };

  // Demande le code de sécurité avant d'autoriser une modification ou une suppression.
  // Chaque utilisateur a son propre code (défini par l'admin dans Gestion des Utilisateurs).
  // Si aucun code n'est configuré pour cet utilisateur, l'action est exécutée directement.
  const requestSecureAction = (action: 'edit' | 'delete', product: Product) => {
    const code = userProfile?.securityCode;
    if (code && code.length === 4) {
      setPendingAction(action);
      setPendingProduct(product);
      setSecurityCode('');
      setSecurityError(false);
      setShowSecurityInput(false);
      setShowSecurityModal(true);
    } else {
      if (action === 'edit') {
        openModal(product);
      } else {
        setProductToDelete(product);
      }
    }
  };

  const confirmSecureAction = () => {
    if (!pendingProduct || !pendingAction) return;
    if (securityCode === userProfile?.securityCode) {
      const action = pendingAction;
      const product = pendingProduct;
      setShowSecurityModal(false);
      setPendingAction(null);
      setPendingProduct(null);
      setSecurityCode('');
      setSecurityError(false);
      if (action === 'edit') {
        openModal(product);
      } else {
        setProductToDelete(product);
      }
    } else {
      setSecurityError(true);
      setSecurityCode('');
    }
  };

  const handleQuickCategoryAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canAddEdit) return;
    if (!newCategoryName.trim()) return;

    // Empêche un second envoi tant que le premier n'est pas terminé (évite les doublons)
    if (isSubmitting) return;

    const exists = categories.some(c => c.name.toLowerCase() === newCategoryName.trim().toLowerCase());
    if (exists) {
      alert('Cette catégorie existe déjà.');
      return;
    }
    
    try {
      setIsSubmitting(true);

      // Vérifie une vraie connexion serveur AVANT d'écrire.
      await ensureOnline();

      await addDoc(collection(db, 'categories'), {
        name: newCategoryName.trim(),
        type: 'autre',
        ownerId
      });
      setFormData(prev => ({ ...prev, category: newCategoryName.trim() }));
      setNewCategoryName('');
    } catch (error: any) {
      if (error?.message === 'OFFLINE') {
        alert("Vérifiez votre connexion Internet.");
      } else {
        handleFirestoreError(error, OperationType.CREATE, 'categories');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetDefaultCategories = async () => {
    if (!confirm('Voulez-vous restaurer les catégories de base par défaut ?')) return;
    const defaults = [
      { id: 'cat_alimentation', name: 'Alimentation' },
      { id: 'cat_boissons', name: 'Boissons' },
      { id: 'cat_entretien', name: 'Entretien' },
      { id: 'cat_produits_frais', name: 'Produits Frais' }
    ];
    for (const cat of defaults) {
      try {
        await setDoc(doc(db, 'categories', cat.id + '_' + ownerId), {
          name: cat.name,
          type: 'autre',
          ownerId
        });
      } catch (err) {
        console.error('Error seeding category:', cat.name, err);
      }
    }
  };



  // Union des catégories Firestore + catégories réellement utilisées par les produits.
  // Garantit que le filtre n'est jamais vide même si la collection `categories`
  // est vide ou que ses documents n'ont pas le bon ownerId.
  const normalizeCat = (s: string) => (s || '').trim().toLowerCase();
  const filterCategories = React.useMemo(() => {
    const map = new Map<string, string>();
    categories.forEach(c => {
      const key = normalizeCat(c.name);
      if (key && !map.has(key)) map.set(key, c.name.trim());
    });
    products.forEach(p => {
      const key = normalizeCat(p.category);
      if (key && !map.has(key)) map.set(key, (p.category || '').trim());
    });
    return Array.from(map.values()).sort((a, b) => a.localeCompare(b));
  }, [categories, products]);

  const filteredProducts = products.filter(p => {
    const matchesSearch =
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.reference && p.reference.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (p.barcode && p.barcode.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesCategory =
      selectedCategory === 'all' || normalizeCat(p.category) === normalizeCat(selectedCategory);
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="mx-auto w-full max-w-[1680px] min-w-0 space-y-6 xl:space-y-8">
      <PageHeader
        title="Articles vendables en caisse"
        actions={<div className="flex flex-wrap gap-2.5">
          {isAdmin && <button
            onClick={previewProductCostMigration}
            disabled={!productCostsLoaded || migrationBusy}
            className="inline-flex min-h-ds-touch-target items-center justify-center gap-2 rounded-ds-md border border-ds-warning/20 bg-ds-warning-soft px-4 py-3 text-xs font-black uppercase tracking-wider text-ds-warning disabled:opacity-50"
          >
            <Shield className="h-4 w-4" /> Migrer les prix d’achat
          </button>}
          {canAddEdit && <Button
            onClick={() => openModal()}
            className="group px-5 py-3 text-xs font-black uppercase tracking-wider shadow-ds-sm"
          >
            <Plus className="w-4 h-4 transition-transform group-hover:rotate-90 duration-300" />
            + NOUVEL ARTICLE
          </Button>}
        </div>}
      />

      {isAdmin && migrationPreview.length > 0 && <section className="space-y-3 rounded-ds-lg border border-ds-warning/20 bg-ds-warning-soft p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="font-black text-ds-warning">Aperçu de la séparation des prix</h2><p className="text-xs text-ds-warning">{migrationPreview.length} article(s) contiennent encore un prix d’achat dans « products ».</p></div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={downloadProductCostBackup} className="border-ds-warning/30 text-ds-warning">Télécharger la sauvegarde JSON</Button>
            <Button onClick={() => void confirmProductCostMigration()} disabled={!migrationBackupDownloaded || migrationBusy} className="border-ds-warning bg-ds-warning text-ds-brand-contrast hover:brightness-90">{migrationBusy ? 'Migration…' : 'Confirmer la migration'}</Button>
          </div>
        </div>
        <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-ds-text">{migrationPreview.slice(0, 100).map(item => <li key={item.id} className="rounded-lg bg-ds-surface/80 px-3 py-2">{item.name} · {item.buyPrice.toFixed(3)} {storeSettings?.currency || 'DT'}</li>)}</ul>
      </section>}

      <Card className="min-w-0 overflow-hidden rounded-ds-lg p-0 shadow-ds-sm">
        <div className="border-b border-ds-border bg-ds-surface-2 p-4 sm:p-5 xl:p-6">
          <div className="flex flex-col gap-3 sm:flex-row xl:gap-4">
            {/* Search bar */}
            <div className="relative min-w-0 flex-1 sm:max-w-md">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-ds-text-muted" />
              <Input
                type="text"
                name="product-search"
                autoComplete="off"
                placeholder="Rechercher un article ou scanner un code-barres..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                aria-label="Rechercher un article ou scanner un code-barres"
                className="pl-11 pr-4 text-base sm:text-sm"
              />
            </div>

            {/* Category filter */}
            <div className="relative w-full sm:w-auto">
              <Tag className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ds-accent pointer-events-none" />
              <Select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                aria-label="Filtrer par catégorie"
                className="min-w-0 pl-10 pr-8 text-base sm:min-w-[180px] sm:text-sm"
              >
                <option value="all">Toutes les catégories</option>
                {filterCategories.map(catName => (
                  <option key={catName} value={catName}>{catName}</option>
                ))}
              </Select>
              <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                <svg className="w-3.5 h-3.5 text-ds-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>

            {/* Active filter badge + reset */}
            {selectedCategory !== 'all' && (
              <button
                onClick={() => setSelectedCategory('all')}
                className="inline-flex min-h-ds-touch-target items-center gap-1.5 rounded-ds-md border border-ds-brand/20 bg-ds-brand-soft px-3 py-2.5 text-xs font-black uppercase tracking-wider text-ds-brand transition-all cursor-pointer hover:bg-ds-brand-soft/80"
                title="Réinitialiser le filtre"
              >
                <X className="w-3.5 h-3.5" />
                {selectedCategory}
              </button>
            )}
          </div>

          {/* Results summary */}
          {(searchTerm || selectedCategory !== 'all') && (
            <p className="mt-2.5 text-xs font-bold uppercase tracking-wider text-ds-text-muted">
              {filteredProducts.length} résultat{filteredProducts.length !== 1 ? 's' : ''} trouvé{filteredProducts.length !== 1 ? 's' : ''}
              {selectedCategory !== 'all' && <span className="text-ds-brand"> · {selectedCategory}</span>}
            </p>
          )}
        </div>

        <div className="min-w-0 max-w-full overflow-x-auto text-sm font-medium text-ds-text">
          <table className="responsive-card-table w-full min-w-0 border-collapse text-left sm:min-w-0">
            <thead>
              <tr className="border-b border-ds-border bg-ds-surface-2 text-xs font-extrabold uppercase tracking-widest text-ds-text-muted">
                <th className="px-6 py-4">ARTICLE</th>
                <th className="px-6 py-4">CATÉGORIE</th>
                {canViewBuyPrice && <th className="px-6 py-4">PRIX ACHAT</th>}
                <th className="px-6 py-4">PRIX VENTE</th>
                <th className="px-6 py-4">STOCK</th>
                {canManageItems && <th className="px-6 py-4 text-right">ACTIONS</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-ds-border">
              {loading ? (
                <tr>
                  <td colSpan={4 + (canViewBuyPrice ? 1 : 0) + (canManageItems ? 1 : 0)} className="px-6 py-10">
                    <div className="space-y-3" role="status" aria-label="Chargement des produits">
                      <div className="mx-auto h-4 max-w-48 animate-pulse rounded bg-ds-surface-2" />
                      <div className="mx-auto h-3 max-w-64 animate-pulse rounded bg-ds-surface-2" />
                    </div>
                  </td>
                </tr>
              ) : filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={4 + (canViewBuyPrice ? 1 : 0) + (canManageItems ? 1 : 0)} className="px-6 py-10">
                    <EmptyState title="Aucun produit trouvé" description="Modifiez la recherche ou le filtre de catégorie." />
                  </td>
                </tr>
              ) : (
                filteredProducts.map((product) => (
                  <tr key={product.id} className="transition-colors hover:bg-ds-surface-2/70">
                    <td data-label="Article" className="px-6 py-4">
                      <div className="font-medium text-ds-text">{product.name}</div>
                      <div className="flex flex-col gap-0.5">
                        {product.reference && (
                          <div className="text-xs font-mono text-ds-accent bg-ds-accent-soft px-1.5 py-0.5 rounded w-fit">
                            REF: {product.reference}
                          </div>
                        )}
                        {!product.reference && product.barcode && (
                          <div className="text-xs font-mono text-ds-accent bg-ds-accent-soft px-1.5 py-0.5 rounded w-fit">
                            REF: {product.barcode}
                          </div>
                        )}
                        {product.expirationDate && (
                          <div className="text-xs text-ds-text-muted">Exp: {product.expirationDate}</div>
                        )}
                      </div>
                    </td>
                    <td data-label="Catégorie" className="px-6 py-4">
                      <Badge variant="info" className="capitalize">
                        {product.category}
                      </Badge>
                    </td>
                    {canViewBuyPrice && <td data-label="Prix achat" className="px-6 py-4 text-ds-text-muted font-mono">{product.inventoryType === 'service' ? '—' : `${(productCosts[product.id] ?? product.buyPrice ?? 0).toFixed(3)} ${storeSettings?.currency || 'DT'}`}</td>}
                    <td data-label="Prix vente" className="px-6 py-4 text-base font-bold font-mono text-ds-text">{product.sellPrice.toFixed(3)} {storeSettings?.currency || 'DT'}</td>
                    <td data-label="Stock" className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        {(() => {
                          const threshold = product.lowStockAlert !== undefined && product.lowStockAlert >= 0
                            ? product.lowStockAlert
                            : (storeSettings?.minStockAlert ?? 5);
                          const isLow = product.stock <= threshold;
                          return (
                            <>
                              {product.inventoryType === 'service' ? (
                                <Badge variant="neutral">Service</Badge>
                              ) : (
                                <Badge
                                  variant={product.stock <= 0 ? 'danger' : isLow ? 'warning' : 'success'}
                                  title={isLow ? `Alerte stock faible (seuil : ${threshold})` : undefined}
                                >
                                  {product.stock <= 0 ? 'Rupture · 0' : isLow ? `Stock faible · ${product.stock}` : `En stock · ${product.stock}`}
                                </Badge>
                              )}
                            </>
                          );
                        })()}
                      </div>
                      {canAdjustStock && product.inventoryType !== 'service' && <div className="mt-2 flex items-center gap-2">
                        <button onClick={() => void adjustProductStock(product, -1)} disabled={product.stock <= 0} className="min-h-11 min-w-11 rounded-lg border border-ds-border bg-ds-surface text-ds-text-muted disabled:opacity-40" title="Retirer une unité">−</button>
                        <button onClick={() => void adjustProductStock(product, 1)} className="min-h-11 min-w-11 rounded-lg border border-ds-border bg-ds-surface text-ds-text-muted" title="Ajouter une unité">+</button>
                        <button
                          onClick={() => {
                            setReplenishProduct(product);
                            setReplenishQty('');
                            setReplenishPrice(isAdmin ? (productCosts[product.id] ?? product.buyPrice).toFixed(3) : '');
                          }}
                          className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-ds-success/20 bg-ds-success-soft px-3 py-1.5 text-xs font-black uppercase tracking-wider text-ds-success hover:brightness-95"
                          title="Approvisionner (ajouter du stock) pour cet article"
                        >
                          + À STOCK
                        </button>
                        <button onClick={() => void openHistory(product)} className="min-h-11 min-w-11 rounded-lg border border-ds-border bg-ds-surface text-ds-text-muted" title="Historique du stock"><History className="w-4 h-4" /></button>
                      </div>}
                    </td>
                    {canManageItems && <td data-label="Actions" className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {canAddEdit && <button
                          onClick={() => requestSecureAction('edit', product)}
                          className="min-h-11 min-w-11 rounded-lg border border-transparent p-2 text-ds-text-muted transition-colors hover:bg-ds-accent-soft hover:text-ds-accent"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>}
                        {canDelete && <button
                          onClick={() => requestSecureAction('delete', product)}
                          className="min-h-11 min-w-11 rounded-lg border border-transparent p-2 text-ds-text-muted transition-colors hover:bg-ds-danger-soft hover:text-ds-danger"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>}
                      </div>
                    </td>}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Modal */}
      {canAddEdit && isModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ds-text/40 p-2 backdrop-blur-sm sm:p-4">
          <Card className="flex max-h-[calc(100vh-24px)] w-full max-w-lg flex-col overflow-hidden rounded-ds-lg p-0 shadow-ds-md sm:max-h-[85vh]">
            <div className="flex-shrink-0 flex items-center justify-between border-b border-ds-border bg-ds-surface-2 px-6 py-4">
              <h2 className="text-lg font-bold text-ds-text">
                {editingProduct ? 'Modifier Article' : 'Nouvel Article'}
              </h2>
              <button onClick={closeModal} className="min-h-11 min-w-11 rounded-lg p-2 text-ds-text-muted hover:bg-ds-surface cursor-pointer" aria-label="Fermer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <div className="min-w-0 flex-1 touch-pan-y space-y-4 overflow-y-auto p-6">
                {errorMsg && (
                  <div className="flex items-start gap-2 rounded-xl border border-ds-danger/20 bg-ds-danger-soft p-3.5 text-xs font-medium text-ds-danger animate-in fade-in duration-150">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span className="break-all">{errorMsg}</span>
                  </div>
                )}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="col-span-2">
                    <label htmlFor="product-name" className="mb-1 block text-sm font-medium text-ds-text">Nom de l'article</label>
                    <Input
                      id="product-name"
                      type="text"
                      required
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="text-base sm:text-sm"
                    />
                  </div>

                  <div className="col-span-2">
                    <label htmlFor="product-reference" className="mb-1 block text-sm font-medium text-ds-text">Référence</label>
                    <Input
                      id="product-reference"
                      type="text"
                      value={formData.reference}
                      placeholder="Ex: REF-001"
                      onChange={(e) => setFormData({ ...formData, reference: e.target.value })}
                      className="text-base sm:text-sm"
                    />
                  </div>

                  <div className="col-span-2 space-y-2">
                    <div className="flex items-center justify-between">
                      <label htmlFor="product-barcode" className="block text-xs font-black uppercase tracking-wider text-ds-text">
                        Code-barres
                      </label>
                      <Badge variant="success" className="gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-ds-success animate-pulse" />
                        Scanner Douchette Prêt
                      </Badge>
                    </div>
                    
                    <div className="relative group">
                      <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                        <Barcode className="h-4.5 w-4.5 text-ds-brand group-focus-within:text-ds-brand-hover" />
                      </div>
                      <Input
                        id="product-barcode"
                        type="text"
                        placeholder="Pointez votre douchette et flashez"
                        value={formData.barcode}
                        onChange={(e) => setFormData({ ...formData, barcode: decodeAzertyBarcode(e.target.value) })}
                        className="min-h-[56px] pl-11 pr-36 font-mono text-base font-bold sm:text-xs"
                      />
                      <div className="absolute right-1.5 top-1.5 flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            const randomCode = normalizeEan13(`619${Math.floor(100000000 + Math.random() * 900000000).toString()}`) || '';
                            setFormData({ ...formData, barcode: randomCode });
                            playBeep('success');
                          }}
                          className="min-h-11 rounded-lg border border-ds-border bg-ds-surface-2 px-2.5 text-[10px] font-black uppercase tracking-wider text-ds-text-muted transition-colors hover:bg-ds-border cursor-pointer"
                          title="Générer un code-barres aléatoire commençant par 619 Tunisie"
                        >
                          Générer
                        </button>
                        <button
                          type="button"
                          onClick={printBarcode}
                          className="min-h-11 rounded-lg bg-ds-brand px-2.5 text-[10px] font-black uppercase tracking-wider text-ds-brand-contrast transition-colors hover:bg-ds-brand-hover cursor-pointer"
                          title="Imprimer l’étiquette EAN-13"
                        >
                          Imprimer
                        </button>
                      </div>
                    </div>

                    {scanStatus === 'scanned' && (
                      <div className="flex items-center gap-2 rounded-xl border border-ds-success/20 bg-ds-success-soft/80 px-3 py-1.5 text-[11px] font-black text-ds-success animate-in fade-in slide-in-from-top-1 duration-300">
                        <span className="inline-block w-2 h-2 rounded-full bg-ds-success animate-ping" />
                        <span>{scanMessage}</span>
                      </div>
                    )}
                    
                    <p className="font-sans text-[10px] leading-relaxed text-ds-text-muted">
                      Vous pouvez scanner directement le produit à tout moment pendant que ce formulaire est ouvert. La douchette remplira automatiquement ce champ et émettra un signal sonore.
                    </p>
                  </div>

                  <label className="col-span-2 flex min-h-11 items-start gap-3 rounded-xl border border-ds-brand/20 bg-ds-brand-soft p-3 text-sm text-ds-text">
                    <input
                      type="checkbox"
                      checked={formData.isService}
                      disabled={!!editingProduct}
                      onChange={(e) => setFormData(current => ({
                        ...current,
                        isService: e.target.checked,
                        ...(e.target.checked ? { buyPrice: 0, stock: 0, lowStockAlert: 0 } : {}),
                      }))}
                      className="mt-0.5 h-4 w-4 rounded border-ds-border text-ds-brand focus:ring-ds-brand"
                    />
                    <span>
                      <span className="block font-bold">C'est un service (main-d'œuvre) — sans prix d'achat ni stock</span>
                      <span className="block text-xs text-ds-text-muted">Les services sont vendables sans suivi ni décrément de stock.</span>
                      {!!editingProduct && <span className="block text-xs text-ds-text-muted">Le type d’article ne peut pas être converti après sa création.</span>}
                    </span>
                  </label>

                  <div className="col-span-2">
                    <label htmlFor="product-category" className="mb-1 block text-sm font-medium text-ds-text">Catégorie</label>
                    <div className="flex gap-2">
                      <Select
                        id="product-category"
                        value={formData.category}
                        onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                        aria-label="Catégorie du produit"
                        className="flex-1 text-base sm:text-sm"
                        required
                      >
                        {categories.length === 0 ? (
                          <option value="">⚠️ Veuillez créer une catégorie</option>
                        ) : (
                          <>
                            <option value="">-- Choisir une catégorie --</option>
                            {categories.map(cat => (
                              <option key={cat.id} value={cat.name}>{cat.name}</option>
                            ))}
                          </>
                        )}
                      </Select>
                      <button
                        type="button"
                        onClick={() => setIsQuickCategoryModalOpen(true)}
                        disabled={!canAddEdit}
                        className="min-h-11 min-w-11 rounded-xl bg-ds-brand-soft text-ds-brand hover:bg-ds-brand/15 transition-colors cursor-pointer"
                        title="Ajouter une catégorie"
                      >
                        <Plus className="w-5 h-5" />
                      </button>
                    </div>
                  </div>

                  {!formData.isService && <div>
                    <label htmlFor="product-stock" className="mb-1 block text-sm font-medium text-ds-text">Stock Initial</label>
                    <Input
                      id="product-stock"
                      type="number"
                      required
                      min="0"
                      value={formData.stock}
                      onChange={(e) => setFormData({ ...formData, stock: parseInt(e.target.value) })}
                      disabled={!!editingProduct}
                      className="text-base sm:text-sm"
                    />
                  </div>}

                  {!formData.isService && <div>
                    <label htmlFor="product-low-stock-alert" className="mb-1 block text-sm font-medium text-ds-text">Alerte stock faible (0)</label>
                    <Input
                      id="product-low-stock-alert"
                      type="number"
                      min="0"
                      value={formData.lowStockAlert}
                      onChange={(e) => setFormData({ ...formData, lowStockAlert: parseInt(e.target.value) })}
                      className="text-base sm:text-sm"
                    />
                  </div>}

                  {canViewBuyPrice && !formData.isService && <div>
                    <label htmlFor="product-buy-price" className="mb-1 block text-sm font-medium text-ds-text">Prix Achat ({storeSettings?.currency || 'DT'})</label>
                    <Input
                      id="product-buy-price"
                      type="text"
                      inputMode="decimal"
                      required
                      value={buyPriceInput}
                      onChange={(e) => {
                        const value = e.target.value.replace(',', '.');
                        if (value === '' || /^\d*\.?\d*$/.test(value)) {
                          setBuyPriceInput(value);
                          const parsed = parseFloat(value) || 0;
                          setFormData({ ...formData, buyPrice: Math.round(parsed * 1000) / 1000 });
                        }
                      }}
                      onBlur={() => {
                        const parsed = parseFloat(buyPriceInput) || 0;
                        const rounded = Math.round(parsed * 1000) / 1000;
                        setBuyPriceInput(rounded === 0 ? '' : rounded.toFixed(3));
                        setFormData({ ...formData, buyPrice: rounded });
                      }}
                      placeholder="0.00"
                      readOnly={!isAdmin}
                      className="text-base read-only:bg-ds-surface-2 sm:text-sm"
                    />
                  </div>}

                  <div>
                    <label htmlFor="product-sell-price" className="mb-1 block text-sm font-medium text-ds-text">Prix Vente ({storeSettings?.currency || 'DT'})</label>
                    <Input
                      id="product-sell-price"
                      type="text"
                      inputMode="decimal"
                      required
                      readOnly={!canEditSellPrice}
                      value={sellPriceInput}
                      onChange={(e) => {
                        const value = e.target.value.replace(',', '.');
                        if (value === '' || /^\d*\.?\d*$/.test(value)) {
                          setSellPriceInput(value);
                          const parsed = parseFloat(value) || 0;
                          setFormData({ ...formData, sellPrice: Math.round(parsed * 1000) / 1000 });
                        }
                      }}
                      onBlur={() => {
                        const parsed = parseFloat(sellPriceInput) || 0;
                        const rounded = Math.round(parsed * 1000) / 1000;
                        setSellPriceInput(rounded === 0 ? '' : rounded.toFixed(3));
                        setFormData({ ...formData, sellPrice: rounded });
                      }}
                      placeholder="0.00"
                      className="text-base read-only:bg-ds-surface-2 sm:text-sm"
                    />
                  </div>

                  <div className="col-span-2">
                    <label htmlFor="product-expiration-date" className="mb-1 block text-sm font-medium text-ds-text">Date Expiration</label>
                    <Input
                      id="product-expiration-date"
                      type="date"
                      value={formData.expirationDate}
                      onChange={(e) => setFormData({ ...formData, expirationDate: e.target.value })}
                      className="text-base sm:text-sm"
                    />
                  </div>
                </div>
              </div>

              <div className="flex-shrink-0 flex gap-3 border-t border-ds-border bg-ds-surface-2 p-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
                <Button
                  variant="secondary"
                  type="button"
                  onClick={closeModal}
                  className="flex-1 text-sm"
                >
                  Annuler
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  loading={isSubmitting}
                  className="flex-1 text-sm"
                >
                  {isSubmitting ? 'Enregistrement…' : (editingProduct ? 'Enregistrer' : 'Ajouter')}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
      {/* Quick Category Modal */}
      {canAddEdit && isQuickCategoryModalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ds-text/40 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <Card className="flex w-full max-w-md flex-col overflow-hidden rounded-ds-lg p-0 shadow-ds-md">
            <div className="flex items-center justify-between border-b border-ds-border bg-ds-surface-2 px-6 py-4">
              <h2 className="flex items-center gap-2 text-base font-black uppercase tracking-wide text-ds-text">
                <Tag className="w-4 h-4 text-ds-brand animate-pulse" />
                Gérer les Catégories
              </h2>
              <button onClick={() => setIsQuickCategoryModalOpen(false)} className="min-h-11 min-w-11 rounded-lg p-2 text-ds-text-muted hover:bg-ds-surface cursor-pointer" aria-label="Fermer">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="space-y-5 p-5">
              {/* Add form */}
              <form onSubmit={handleQuickCategoryAdd} className="space-y-2">
                <label htmlFor="new-category-name" className="block text-xs font-black uppercase tracking-wider text-ds-text-muted">Nouveau nom de catégorie</label>
                <div className="flex gap-2">
                  <Input
                    id="new-category-name"
                    type="text"
                    autoFocus
                    required
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    className="flex-1 text-base sm:text-sm"
                    placeholder="Ex: Boissons, Fruits..."
                  />
                  <Button
                    type="submit"
                    className="text-xs font-black uppercase tracking-wider"
                  >
                    <Plus className="w-4 h-4" />
                    Ajouter
                  </Button>
                </div>
              </form>

              {/* List of existing categories */}
              <div className="space-y-2.5">
                <span className="mb-1 block border-b border-ds-border pb-1.5 text-xs font-black uppercase tracking-wider text-ds-text-muted">
                  Catégories existantes ({categories.length})
                </span>
                
                <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                  {categories.length === 0 ? (
                    <EmptyState className="py-6" title="Aucune catégorie enregistrée" />
                  ) : (
                    categories.map((cat) => (
                      <div key={cat.id} className="group flex items-center justify-between rounded-xl border border-ds-border bg-ds-surface-2 px-3 py-2 transition-all hover:bg-ds-surface">
                        {deletingCatId === cat.id ? (
                          <div className="flex items-center justify-between w-full animate-in fade-in slide-in-from-right-1 duration-150">
                            <span className="flex items-center gap-1 text-[11px] font-black uppercase tracking-wider text-ds-danger">
                              <AlertTriangle className="w-3.5 h-3.5 text-ds-danger" />
                              Supprimer?
                            </span>
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => setDeletingCatId(null)}
                                className="min-h-11 rounded-lg bg-ds-surface-2 px-3 py-1 text-[10px] font-bold text-ds-text-muted hover:text-ds-text transition-colors cursor-pointer"
                              >
                                Non
                              </button>
                              <button
                                type="button"
                                onClick={() => executeCategoryDelete(cat.id, cat.name)}
                                className="min-h-11 rounded-lg bg-ds-danger px-3 py-1 text-[10px] font-black text-ds-brand-contrast hover:brightness-90 transition-all cursor-pointer"
                              >
                                Oui
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <span className="flex items-center gap-2 text-xs font-bold text-ds-text">
                              <Tag className="w-3.5 h-3.5 text-ds-text-muted group-hover:text-ds-brand transition-colors" />
                              {cat.name}
                            </span>
                            
                            <button
                              type="button"
                              onClick={() => setDeletingCatId(cat.id)}
                              className="min-h-11 min-w-11 rounded-lg p-1.5 text-ds-text-muted hover:bg-ds-danger-soft hover:text-ds-danger transition-colors cursor-pointer"
                              title={`Supprimer la catégorie ${cat.name}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-ds-border bg-ds-surface-2 px-6 py-3">
              <button
                type="button"
                onClick={handleResetDefaultCategories}
                className="min-h-11 text-ds-text-muted hover:text-ds-brand text-[10px] font-black uppercase tracking-wider underline cursor-pointer"
                title="Restaurer les catégories de base par défaut"
              >
                Réinit. défauts
              </button>
              <Button
                variant="secondary"
                type="button"
                onClick={() => {
                  setDeletingCatId(null);
                  setIsQuickCategoryModalOpen(false);
                }}
                className="text-xs font-black uppercase tracking-wider"
              >
                Fermer
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Security Code Modal (protects edit & delete) */}
      {showSecurityModal && pendingProduct && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-ds-text/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <Card className="w-full max-w-sm overflow-hidden rounded-ds-lg p-0 shadow-ds-md">
            <div className="flex items-center justify-between border-b border-ds-border bg-ds-danger-soft/60 px-6 py-4">
              <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wider text-ds-text">
                <Shield className="w-4 h-4 text-ds-danger" />
                Code de sécurité requis
              </h3>
              <button
                onClick={() => { setShowSecurityModal(false); setPendingAction(null); setPendingProduct(null); setSecurityCode(''); setSecurityError(false); }}
                className="min-h-11 min-w-11 rounded-lg p-1.5 text-ds-text-muted hover:bg-ds-surface"
                aria-label="Fermer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-4 p-6">
              <p className="text-xs font-medium text-ds-text-muted">
                Saisissez le code de sécurité à 4 chiffres pour autoriser {pendingAction === 'edit' ? 'la modification' : 'la suppression'} du produit <strong className="text-ds-text">"{pendingProduct.name}"</strong>.
              </p>
              <div className="relative">
                <Shield className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ds-text-muted" />
                <Input
                  type={showSecurityInput ? 'text' : 'password'}
                  name="product-security-code"
                  autoComplete="one-time-code"
                  maxLength={4}
                  inputMode="numeric"
                  autoFocus
                  aria-label="Code de sécurité à 4 chiffres"
                  value={securityCode}
                  onChange={(e) => {
                    const val = e.target.value.replace(/[^0-9]/g, '').slice(0, 4);
                    setSecurityCode(val);
                    setSecurityError(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && securityCode.length === 4) {
                      confirmSecureAction();
                    }
                  }}
                  placeholder="● ● ● ●"
                  className={`w-full pl-9 pr-10 py-3 border-2 rounded-xl text-center text-xl font-mono font-black tracking-[0.5em] outline-none transition-colors ${
                    securityError
                      ? 'border-ds-danger bg-ds-danger-soft text-ds-danger focus:border-ds-danger'
                      : 'border-ds-border bg-ds-surface text-ds-text focus:border-ds-brand focus:ring-2 focus:ring-ds-brand/10'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowSecurityInput(!showSecurityInput)}
                  className="absolute right-0 top-1/2 min-h-11 min-w-11 -translate-y-1/2 text-ds-text-muted hover:text-ds-text"
                  aria-label={showSecurityInput ? 'Masquer le code' : 'Afficher le code'}
                >
                  {showSecurityInput ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" /> }
                </button>
              </div>
              {securityError && (
                <p className="flex items-center gap-1.5 text-xs font-bold text-ds-danger">
                  <AlertCircle className="w-3.5 h-3.5" />
                  Code incorrect. Veuillez réessayer.
                </p>
              )}
              <div className="flex gap-3 pt-1">
                <Button
                  variant="secondary"
                  onClick={() => { setShowSecurityModal(false); setPendingAction(null); setPendingProduct(null); setSecurityCode(''); setSecurityError(false); }}
                  className="flex-1 text-xs uppercase tracking-wider"
                >
                  Annuler
                </Button>
                <Button
                  onClick={confirmSecureAction}
                  className="flex-1 text-xs font-black uppercase tracking-wider"
                >
                  Valider
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Product Delete Confirmation Modal */}
      {productToDelete && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-ds-text/50 p-4 backdrop-blur-xs animate-in fade-in duration-200">
          <Card className="w-full max-w-sm space-y-4 rounded-ds-lg p-6 shadow-ds-md">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-ds-danger-soft p-2 text-ds-danger">
                <AlertTriangle className="w-6 h-6 animate-pulse" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-black uppercase tracking-wider text-ds-text">Supprimer le produit ?</h3>
                <p className="text-xs leading-relaxed text-ds-text-muted">
                  Êtes-vous sûr de vouloir supprimer définitivement le produit <strong className="text-ds-text">"{productToDelete.name}"</strong> ? Cette action est irréversible.
                </p>
              </div>
            </div>

            {errorMsg && (
              <div className="flex items-start gap-2 rounded-xl border border-ds-danger/20 bg-ds-danger-soft p-3 text-xs font-medium text-ds-danger animate-in fade-in duration-150">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span className="break-all">{errorMsg}</span>
              </div>
            )}
            
            <div className="flex gap-3 justify-end pt-2">
              <Button
                variant="secondary"
                type="button"
                onClick={() => setProductToDelete(null)}
                className="text-xs font-bold uppercase tracking-wider"
              >
                Annuler
              </Button>
              <Button
                variant="danger"
                type="button"
                onClick={executeProductDelete}
                className="text-xs font-black uppercase tracking-wider"
              >
                Supprimer
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Replenish Stock Modal */}
      {replenishProduct && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-ds-text/50 p-2 backdrop-blur-xs animate-in fade-in duration-200 sm:p-4">
          <Card className="flex max-h-[calc(100vh-24px)] w-full max-w-md flex-col overflow-hidden rounded-ds-lg p-0 shadow-ds-md sm:max-h-[85vh]">
            <div className="flex-shrink-0 flex items-center justify-between border-b border-ds-border px-6 py-4">
              <h3 className="text-sm font-black uppercase tracking-wider text-ds-text">
                Approvisionner : {replenishProduct.name}
              </h3>
              <button 
                onClick={() => setReplenishProduct(null)}
                className="min-h-11 min-w-11 rounded-lg p-1 text-ds-text-muted hover:bg-ds-surface-2 cursor-pointer"
                aria-label="Fermer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={handleReplenishSubmit} className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <div className="flex-1 touch-pan-y space-y-4 overflow-y-auto p-6">
                <div>
                  <label htmlFor="replenish-quantity" className="mb-1 block text-xs font-black uppercase tracking-wider text-ds-text-muted">
                    Quantité à ajouter au stock
                  </label>
                  <Input
                    id="replenish-quantity"
                    type="number"
                    required
                    min="1"
                    placeholder="Ex: 50"
                    value={replenishQty}
                    onChange={(e) => setReplenishQty(e.target.value)}
                    className="text-base font-bold sm:text-sm"
                  />
                </div>

                {isAdmin && <div>
                  <label htmlFor="replenish-buy-price" className="mb-1 block text-xs font-black uppercase tracking-wider text-ds-text-muted">
                    Prix d'achat unitaire ({storeSettings?.currency || 'DT'})
                  </label>
                  <Input
                    id="replenish-buy-price"
                    type="number"
                    step="0.001"
                    required
                    min="0.001"
                    placeholder="Ex: 2.500"
                    value={replenishPrice}
                    onChange={(e) => setReplenishPrice(e.target.value)}
                    className="font-mono text-base font-bold sm:text-sm"
                  />
                </div>}

                {isAdmin && replenishQty && replenishPrice && (
                  <div className="my-2 space-y-1 rounded-xl border border-ds-border bg-ds-surface-2 p-3.5">
                    <div className="flex justify-between text-xs font-medium text-ds-text-muted">
                      <span>Quantité :</span>
                      <span className="font-bold text-ds-text">{replenishQty}</span>
                    </div>
                    <div className="flex justify-between text-xs font-medium text-ds-text-muted">
                      <span>Prix unitaire :</span>
                      <span className="font-bold text-ds-text">{parseFloat(replenishPrice).toFixed(3)} {storeSettings?.currency || 'DT'}</span>
                    </div>
                    <div className="my-1.5 flex justify-between border-t border-ds-border pt-1.5 text-xs font-bold text-ds-text">
                      <span>Dépense totale estimée :</span>
                      <span className="font-black text-ds-success">
                        {(parseInt(replenishQty) * parseFloat(replenishPrice)).toFixed(3)} {storeSettings?.currency || 'DT'}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex-shrink-0 flex justify-end gap-3 border-t border-ds-border bg-ds-surface-2 p-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] animate-in fade-in duration-200">
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() => setReplenishProduct(null)}
                  className="text-xs font-bold uppercase tracking-wider"
                >
                  Annuler
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  loading={isSubmitting}
                  className="text-xs font-black uppercase tracking-wider"
                >
                  {isSubmitting ? 'En cours…' : 'Confirmer'}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* Stock History Modal (diagnostic) */}
      {historyProduct && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ds-text/40 p-2 backdrop-blur-sm sm:p-4">
          <Card className="flex max-h-[calc(100vh-24px)] w-full max-w-lg flex-col overflow-hidden rounded-ds-lg p-0 shadow-ds-md animate-in zoom-in-95 duration-150 sm:max-h-[85vh]">
            <div className="flex-shrink-0 flex items-center justify-between border-b border-ds-border bg-ds-surface-2 px-6 py-4">
              <h2 className="flex items-center gap-2 text-lg font-bold text-ds-text">
                <History className="w-5 h-5 text-ds-brand" />
                Historique : {historyProduct.name}
              </h2>
              <button
                onClick={() => setHistoryProduct(null)}
                className="min-h-11 min-w-11 rounded-lg p-2 text-ds-text-muted hover:bg-ds-surface cursor-pointer"
                aria-label="Fermer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="min-w-0 flex-1 touch-pan-y space-y-4 overflow-y-auto p-6">
              {historyLoading && (
                <div className="flex flex-col items-center justify-center gap-3 py-10 text-ds-text-muted" role="status">
                  <Loader2 className="w-8 h-8 animate-spin" />
                  <span className="text-sm font-medium">Chargement de l'historique…</span>
                </div>
              )}

              {!historyLoading && historyError && (
                <div className="flex items-start gap-2 rounded-xl border border-ds-danger/20 bg-ds-danger-soft p-3.5 text-xs font-medium text-ds-danger">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>Erreur : {historyError}</span>
                </div>
              )}

              {!historyLoading && !historyError && historyTotals && (() => {
                const displayedStock = historyProduct.stock || 0;
                const theoretical = historyTotals.totalIn - historyTotals.totalOut;
                const gap = displayedStock - theoretical;
                return (
                  <>
                    {/* Résumé */}
                    <div className="grid grid-cols-3 gap-2">
                      <div className="rounded-xl border border-ds-success/20 bg-ds-success-soft p-3 text-center">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-ds-success">Entrées</div>
                        <div className="text-xl font-black text-ds-success">{historyTotals.totalIn}</div>
                      </div>
                      <div className="rounded-xl border border-ds-accent/20 bg-ds-accent-soft p-3 text-center">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-ds-accent">Ventes</div>
                        <div className="text-xl font-black text-ds-accent">{historyTotals.totalOut}</div>
                      </div>
                      <div className="rounded-xl border border-ds-border bg-ds-surface-2 p-3 text-center">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-ds-text-muted">Théorique</div>
                        <div className="text-xl font-black text-ds-text">{theoretical}</div>
                      </div>
                    </div>

                    {/* Verdict écart */}
                    <div className={cn(
                      "flex items-start gap-3 rounded-xl border p-4",
                      gap === 0 ? "bg-ds-success-soft border-ds-success/20" : "bg-ds-warning-soft border-ds-warning/20"
                    )}>
                      {gap === 0
                        ? <Package className="mt-0.5 w-5 h-5 flex-shrink-0 text-ds-success" />
                        : <AlertTriangle className="mt-0.5 w-5 h-5 flex-shrink-0 text-ds-warning" />}
                      <div className="text-xs leading-relaxed">
                        <div className="font-bold text-ds-text">
                          Stock affiché : {displayedStock} &nbsp;·&nbsp; Théorique : {theoretical} &nbsp;·&nbsp; Écart : {gap > 0 ? '+' : ''}{gap}
                        </div>
                        <div className="mt-1 text-ds-text-muted">
                          {gap === 0 && "Cohérent : le stock affiché correspond aux mouvements enregistrés."}
                          {gap > 0 && `${gap} unité(s) en trop. Cause probable : édition manuelle du stock, ou vente hors-ligne dont la décrémentation a été écrasée à la synchronisation.`}
                          {gap < 0 && `${-gap} unité(s) manquante(s). Cause probable : vente comptée en double, ou approvisionnement non enregistré.`}
                        </div>
                      </div>
                    </div>

                    {/* Journal des mouvements */}
                    <div>
                      <div className="mb-2 text-xs font-bold uppercase tracking-wider text-ds-text-muted">
                        Mouvements ({historyMovements.length})
                      </div>
                      {historyMovements.length === 0 ? (
                        <div className="py-4 text-center text-sm italic text-ds-text-muted">
                          Aucun mouvement enregistré. Le stock a probablement été saisi manuellement.
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          {historyMovements.map((m, i) => (
                            <div
                              key={i}
                              className="flex items-center justify-between rounded-lg border border-ds-border bg-ds-surface-2 px-3 py-2 text-xs"
                            >
                              <div className="flex items-center gap-2">
                                {m.type === 'in'
                                  ? <ArrowUp className="w-3.5 h-3.5 text-ds-success" />
                                  : <ArrowDown className="w-3.5 h-3.5 text-ds-accent" />}
                                <span className="font-medium text-ds-text">{m.label}</span>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="text-ds-text-muted">
                                  {m.date ? m.date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'}
                                </span>
                                <span className={cn(
                                  "font-black tabular-nums",
                                  m.type === 'in' ? "text-ds-success" : "text-ds-accent"
                                )}>
                                  {m.type === 'in' ? '+' : '−'}{m.qty}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>

            <div className="flex-shrink-0 flex justify-end border-t border-ds-border bg-ds-surface-2 p-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
              <Button
                variant="secondary"
                type="button"
                onClick={() => setHistoryProduct(null)}
                className="text-xs font-bold uppercase tracking-wider"
              >
                Fermer
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
