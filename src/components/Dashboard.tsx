import { useState, useEffect, useMemo, useRef } from 'react';
import { collection, onSnapshot, query, orderBy, limit, doc, updateDoc, deleteDoc, where } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { Sale, Product, StoreSettings, UserProfile } from '../types';
import { handleFirestoreError, OperationType } from '../App';
import { createPortal } from 'react-dom';
import * as XLSX from 'xlsx';
import { 
  TrendingUp, 
  Wallet, 
  Package, 
  AlertTriangle, 
  ArrowUpRight, 
  ArrowDownRight, 
  ShoppingCart, 
  Users, 
  Coins, 
  Clock, 
  Calendar, 
  AlertCircle,
  X,
  Search,
  ArrowUpDown,
  Printer,
  Download,
  ChevronLeft,
  ChevronRight,
  Edit2,
  Trash2,
  PackagePlus,
  BarChart3,
  Wrench,
  Percent,
  Sparkles
} from 'lucide-react';
import { isSameDay } from 'date-fns';
import { Link } from 'react-router-dom';
import { cn } from '../lib/utils';
import SalesVolumeChart from './SalesVolumeChart';
import { Badge, Button, Card, EmptyState, PageHeader } from './ui';
import { can, hasMenuAccess } from '../lib/permissions';
import { computeSaleProfit, computeTotals, normalizeFinancialSettings, type SaleCostLine } from '../lib/financial';
import { computeWorkshopSummary, isWithinReportPeriod } from '../lib/workshopReports';
import { computeExpectedCash } from '../lib/cashSessionMath';
import type { CashSession } from '../types';
import { slugifyAppName } from '../lib/brand';
import { useBrand } from './BrandProvider';
import { getDateLocale } from '../i18n/format';

// Helper component for printing high-quality A4 reports
interface PrintableReportProps {
  activeModal: 'revenue' | 'profit' | 'debt' | 'sales' | 'expenses' | 'stock';
  records: any[];
  storeSettings: StoreSettings | null;
  currency: string;
  canViewBuyPrice: boolean;
  canViewCosts: boolean;
}

function PrintableReport({ activeModal, records, storeSettings, currency, canViewBuyPrice, canViewCosts }: PrintableReportProps) {
  const brand = useBrand();
  const canViewMargin = canViewBuyPrice && canViewCosts;
  const title = activeModal === 'revenue' ? "RAPPORT D'ACTIVITÉ : CHIFFRE D'AFFAIRES"
    : activeModal === 'profit' ? "RAPPORT D'ACTIVITÉ : BÉNÉFICE NET (PERFORMANCE)"
    : activeModal === 'debt' ? "RAPPORT DE TRÉSORERIE : DETTES CLIENTS"
    : activeModal === 'stock' ? "RAPPORT D'INVENTAIRE : VALORISATION DE STOCK"
    : "RAPPORT D'ACTIVITÉ : CRÉATIONS DE BILLETS / TRANSACTIONS";

  const printedDate = new Date().toLocaleDateString(getDateLocale(), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  return (
    <div className="print-report-container print-container p-8 font-sans text-ds-text bg-ds-surface leading-relaxed text-xs">
      <div className="flex justify-between items-start border-b-2 border-ds-border pb-5 mb-5">
        <div>
          <h1 className="text-base font-bold uppercase tracking-tight text-ds-text">{storeSettings?.storeName || brand.storeName}</h1>
          {storeSettings?.address && <p className="text-[10px] text-ds-muted">{storeSettings.address}</p>}
          {storeSettings?.phone && <p className="text-[10px] text-ds-muted">Tél: {storeSettings.phone}</p>}
        </div>
        <div className="text-end">
          <h2 className="text-xs font-bold uppercase tracking-wider text-ds-text">Synthèse Historique de Caisse</h2>
          <p className="text-[10px] text-ds-muted mt-1">Imprimé le {printedDate}</p>
        </div>
      </div>

      <div className="text-center font-bold text-sm tracking-wide bg-ds-surface-2 py-3 border border-ds-border rounded-xl my-4 text-ds-text">
        {title}
      </div>

      <table className="w-full border-collapse text-start border border-ds-border mt-4 text-[11px]">
        <thead>
          <tr className="bg-ds-surface-2 uppercase font-black text-ds-text border-b border-ds-border">
            {activeModal === 'stock' ? (
              <>
                <th className="py-2 px-3 border border-ds-border">Désignation</th>
                <th className="py-2 px-3 text-center border border-ds-border">Stock Dispo</th>
                {canViewBuyPrice && <th className="py-2 px-3 text-end border border-ds-border">P.A. Unit</th>}
                <th className="py-2 px-3 text-end border border-ds-border">P.V. Unit</th>
                {canViewBuyPrice && <th className="py-2 px-3 text-end border border-ds-border">Total Achat</th>}
                <th className="py-2 px-3 text-end border border-ds-border bg-ds-surface-2 font-bold">Total Vente (Revenus)</th>
                {canViewCosts && <th className="py-2 px-3 text-end border border-ds-border font-bold">Marge Théorique</th>}
              </>
            ) : (
              <th className="py-2 px-3 border border-ds-border">Date de l'Activité</th>
            )}
            {activeModal === 'revenue' && (
              <>
                <th className="py-2 px-3 text-center border border-ds-border">Nb de Ventes</th>
                <th className="py-2 px-3 text-end border border-ds-border">Total Encaissé</th>
                <th className="py-2 px-3 text-end border border-ds-border">Dettes Générées</th>
                <th className="py-2 px-3 text-end border border-ds-border bg-ds-surface-2 font-bold">Chiffre d'Affaires</th>
              </>
            )}
            {activeModal === 'profit' && (
              <>
                <th className="py-2 px-3 text-end border border-ds-border">Chiffre d'Affaires</th>
                <th className="py-2 px-3 text-end border border-ds-border">Coûts et dépenses</th>
                <th className="py-2 px-3 text-center border border-ds-border">Marge Ratio (%)</th>
                <th className="py-2 px-3 text-end border border-ds-border bg-ds-surface-2 font-bold">Bénéfice Net</th>
              </>
            )}
            {activeModal === 'debt' && (
              <>
                <th className="py-2 px-3 text-end border border-ds-border">Chiffre d'Affaires</th>
                <th className="py-2 px-3 text-end border border-ds-border">Revenus Perçus</th>
                <th className="py-2 px-3 text-center border border-ds-border">Ventes Totales</th>
                <th className="py-2 px-3 text-end border border-ds-border bg-ds-surface-2 font-bold text-ds-danger">Impayés Restants</th>
              </>
            )}
            {activeModal === 'sales' && (
              <>
                <th className="py-2 px-3 text-center border border-ds-border">Tickets encaissés</th>
                <th className="py-2 px-3 text-end border border-ds-border">Panier Moyen journalier</th>
                <th className="py-2 px-3 text-center border border-ds-border bg-ds-surface-2 font-bold">Total Transactions</th>
              </>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-ds-border">
          {records.map((rec, idx) => {
            if (activeModal === 'stock') {
              const stock = rec.stock || 0;
              const buyVal = canViewBuyPrice ? stock * (rec.buyPrice || 0) : 0;
              const sellVal = stock * (rec.sellPrice || 0);
              const margin = canViewMargin ? sellVal - buyVal : 0;
              return (
                <tr key={rec.id || idx} className="hover:bg-ds-surface-2/20">
                  <td className="py-2 px-3 font-semibold border border-ds-border">{rec.name}</td>
                  <td className="py-2 px-3 text-center border border-ds-border">{stock}</td>
                  {canViewBuyPrice && <td className="py-2 px-3 text-end border border-ds-border font-mono">{(rec.buyPrice || 0).toFixed(3)} {currency}</td>}
                  <td className="py-2 px-3 text-end border border-ds-border font-mono">{(rec.sellPrice || 0).toFixed(3)} {currency}</td>
                  {canViewBuyPrice && <td className="py-2 px-3 text-end border border-ds-border font-mono">{buyVal.toFixed(3)} {currency}</td>}
                  <td className="py-2 px-3 text-end border border-ds-border bg-ds-surface-2 font-mono font-bold">{sellVal.toFixed(3)} {currency}</td>
                  {canViewCosts && <td className="py-2 px-3 text-end border border-ds-border font-mono font-bold">{margin.toFixed(3)} {currency}</td>}
                </tr>
              );
            }

            const dateLabel = rec.dateObj.toLocaleDateString(getDateLocale(), {
              weekday: 'short',
              day: '2-digit',
              month: 'short',
              year: 'numeric'
            });
            return (
              <tr key={rec.dateStr} className="hover:bg-ds-surface-2/20">
                <td className="py-2 px-3 font-semibold border border-ds-border capitalize">{dateLabel}</td>
                {activeModal === 'revenue' && (
                  <>
                    <td className="py-2 px-3 text-center border border-ds-border">{rec.salesCount}</td>
                    <td className="py-2 px-3 text-end border border-ds-border font-mono">{rec.cashAmount.toFixed(3)} {currency}</td>
                    <td className="py-2 px-3 text-end border border-ds-border font-mono">{rec.debt.toFixed(3)} {currency}</td>
                    <td className="py-2 px-3 text-end border border-ds-border bg-ds-surface-2 font-mono font-bold">{rec.revenue.toFixed(3)} {currency}</td>
                  </>
                )}
                {activeModal === 'profit' && (
                  <>
                    <td className="py-2 px-3 text-end border border-ds-border font-mono">{rec.revenue.toFixed(3)} {currency}</td>
                    <td className="py-2 px-3 text-end border border-ds-border font-mono">{rec.profitComplete ? `${(rec.revenue - rec.profit).toFixed(3)} ${currency}` : 'Coûts manquants'}</td>
                    <td className="py-2 px-3 text-center border border-ds-border font-mono font-bold">
                      {rec.profitComplete && rec.revenue > 0 ? ((rec.profit / rec.revenue) * 100).toFixed(1) + '%' : '—'}
                    </td>
                    <td className="py-2 px-3 text-end border border-ds-border bg-ds-surface-2 font-mono font-bold">{rec.profitComplete ? `${rec.profit.toFixed(3)} ${currency}` : '—'}</td>
                  </>
                )}
                {activeModal === 'debt' && (
                  <>
                    <td className="py-2 px-3 text-end border border-ds-border font-mono">{rec.revenue.toFixed(3)} {currency}</td>
                    <td className="py-2 px-3 text-end border border-ds-border font-mono">{rec.cashAmount.toFixed(3)} {currency}</td>
                    <td className="py-2 px-3 text-center border border-ds-border">{rec.salesCount}</td>
                    <td className="py-2 px-3 text-end border border-ds-border bg-ds-surface-2 font-mono font-bold text-ds-danger">{rec.debt.toFixed(3)} {currency}</td>
                  </>
                )}
                {activeModal === 'sales' && (
                  <>
                    <td className="py-2 px-3 text-center border border-ds-border">{rec.salesCount}</td>
                    <td className="py-2 px-3 text-end border border-ds-border font-mono">
                      {rec.salesCount > 0 ? (rec.revenue / rec.salesCount).toFixed(3) : '0.000'} {currency}
                    </td>
                    <td className="py-2 px-3 text-center border border-ds-border bg-ds-surface-2 font-mono font-bold">{rec.salesCount}</td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="mt-8 pt-4 border-t border-ds-border text-[10px] text-center text-ds-muted font-bold uppercase tracking-widest">
        RAZ de caisse - Fin du rapport d'activité
      </div>
    </div>
  );
}

interface DashboardProps {
  userProfile: UserProfile | null;
  cashSession: CashSession | null;
}

export default function Dashboard({ userProfile, cashSession }: DashboardProps) {
  const brand = useBrand();
  const [sales, setSales] = useState<Sale[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [saleCostSnapshots, setSaleCostSnapshots] = useState<Record<string, SaleCostLine[]>>({});
  const [repairs, setRepairs] = useState<any[]>([]);
  const [repairCostSnapshots, setRepairCostSnapshots] = useState<Record<string, Record<string, number>>>({});
  const [expenses, setExpenses] = useState<any[]>([]);
  const productCostsRef = useRef<Record<string, number>>({});
  const [storeSettings, setStoreSettings] = useState<StoreSettings | null>(null);
  const [loading, setLoading] = useState(true);

  // States for detailed history modal
  const [activeModal, setActiveModal] = useState<'revenue' | 'profit' | 'debt' | 'sales' | 'expenses' | 'stock' | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [periodFilter, setPeriodFilter] = useState<'today' | '7' | '30' | '90' | 'year' | 'all' | 'custom'>('30');
  const [financialPeriod, setFinancialPeriod] = useState<'today' | '7' | '30' | '90' | 'year' | 'all'>('today');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [sortField, setSortField] = useState<'date' | 'value'>('date');
  const [sortAsc, setSortAsc] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const [stockAlertDismissed, setStockAlertDismissed] = useState(false);

  // Real-time track and aggregate stock supplies (expenses/dépenses)
  const [supplies, setSupplies] = useState<any[]>([]);
  const [expensesTab, setExpensesTab] = useState<'daily' | 'detailed'>('daily');
  const [expensesSearch, setExpensesSearch] = useState('');
  const [expensesPage, setExpensesPage] = useState(1);
  const expensesItemsPerPage = 10;

  const [editingSupply, setEditingSupply] = useState<any | null>(null);
  const [editingSupplyQty, setEditingSupplyQty] = useState('');
  const [editingSupplyPrice, setEditingSupplyPrice] = useState('');

  const ownerId = (userProfile?.role === 'admin' ? userProfile?.uid : userProfile?.ownerId) || userProfile?.uid || auth.currentUser?.uid;
  const isAdmin = userProfile?.role === 'admin';
  const canViewBuyPrice = can(userProfile, 'products', 'viewBuyPrice');
  const canViewCosts = can(userProfile, 'reparation', 'viewCosts');
  const canViewMargin = canViewBuyPrice && canViewCosts;
  const canShowBuyPrice = isAdmin && canViewBuyPrice;
  const canShowMargin = isAdmin && canViewMargin;
  const canAccessCashSession = hasMenuAccess(userProfile, 'pos') || hasMenuAccess(userProfile, 'invoices');
  const canViewSales = canAccessCashSession || hasMenuAccess(userProfile, 'sales');

  useEffect(() => {
    if (!canViewMargin && activeModal === 'profit') setActiveModal(null);
  }, [activeModal, canViewMargin]);

  useEffect(() => {
    if (!auth.currentUser || !ownerId) return;
    productCostsRef.current = {};
    // Fetch sales belonging to this store, sort client-side to avoid composite indexes
    const qSales = query(collection(db, 'sales'), where('ownerId', '==', ownerId));
    const unsubscribeSales = onSnapshot(qSales, (snapshot) => {
      const sls = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Sale));
      sls.sort((a, b) => {
        const timeA = a.date?.seconds || 0;
        const timeB = b.date?.seconds || 0;
        return timeB - timeA;
      });
      setSales(sls);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'sales'));

    const unsubscribeProds = onSnapshot(query(collection(db, 'products'), where('ownerId', '==', ownerId)), (snapshot) => {
      setProducts(snapshot.docs.map(item => {
        const data = item.data();
        const legacyBuyPrice = isAdmin ? Number(data.buyPrice) || 0 : 0;
        delete data.buyPrice;
        return {
          id: item.id,
          ...data,
          buyPrice: canViewBuyPrice ? (productCostsRef.current[item.id] ?? legacyBuyPrice) : 0,
        } as Product;
      }));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'products'));

    const unsubscribeCosts = canViewBuyPrice
      ? onSnapshot(query(collection(db, 'product_costs'), where('ownerId', '==', ownerId)), snapshot => {
        const costs = Object.fromEntries(snapshot.docs.map(item => [item.id, Number(item.data().buyPrice) || 0]));
        productCostsRef.current = costs;
        setProducts(current => current.map(product => ({
          ...product,
          buyPrice: costs[product.id] ?? product.buyPrice,
        })));
      }, error => handleFirestoreError(error, OperationType.LIST, 'product_costs'))
      : () => {
        productCostsRef.current = {};
      };

    const unsubscribeSupplies = isAdmin
      ? onSnapshot(query(collection(db, 'supplies'), where('ownerId', '==', ownerId)), (snapshot) => {
        const sups = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
        sups.sort((a, b) => {
          const timeA = a.date?.seconds || (a.date instanceof Date ? a.date.getTime() : 0);
          const timeB = b.date?.seconds || (b.date instanceof Date ? b.date.getTime() : 0);
          return timeB - timeA;
        });
        setSupplies(sups);
      }, (error) => handleFirestoreError(error, OperationType.LIST, 'supplies'))
      : () => setSupplies([]);

    const unsubscribeSaleCosts = canViewMargin
      ? onSnapshot(query(collection(db, 'sale_costs'), where('ownerId', '==', ownerId)), snapshot => {
        setSaleCostSnapshots(Object.fromEntries(snapshot.docs.map(item => [
          item.id,
          (item.data().items || []) as SaleCostLine[],
        ])));
      }, error => handleFirestoreError(error, OperationType.LIST, 'sale_costs'))
      : () => setSaleCostSnapshots({});

    const unsubscribeRepairs = isAdmin
      ? onSnapshot(query(collection(db, 'repairs'), where('ownerId', '==', ownerId)), snapshot => {
        setRepairs(snapshot.docs.map(item => ({ id: item.id, ...item.data() })));
      }, error => handleFirestoreError(error, OperationType.LIST, 'repairs'))
      : () => setRepairs([]);

    const unsubscribeRepairCosts = canViewMargin
      ? onSnapshot(query(collection(db, 'repair_costs'), where('ownerId', '==', ownerId)), snapshot => {
        setRepairCostSnapshots(Object.fromEntries(snapshot.docs.map(item => [
          item.id,
          Object.fromEntries(((item.data().parts || []) as Array<{ productId: string; unitBuyPrice: number }>)
            .map(part => [part.productId, Number(part.unitBuyPrice) || 0])),
        ])));
      }, error => handleFirestoreError(error, OperationType.LIST, 'repair_costs'))
      : () => setRepairCostSnapshots({});

    const unsubscribeExpenses = isAdmin
      ? onSnapshot(query(collection(db, 'expenses'), where('ownerId', '==', ownerId)), snapshot => {
        setExpenses(snapshot.docs.map(item => ({ id: item.id, ...item.data() })));
      }, error => handleFirestoreError(error, OperationType.LIST, 'expenses'))
      : () => setExpenses([]);

    const unsubscribeStore = onSnapshot(doc(db, 'settings', ownerId), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data() as StoreSettings;
        setStoreSettings({ ...data, ...normalizeFinancialSettings(data) });
      }
      setLoading(false);
    }, (error) => handleFirestoreError(error, OperationType.GET, `settings/${ownerId}`));

    return () => {
      unsubscribeSales();
      unsubscribeProds();
      unsubscribeCosts();
      unsubscribeSupplies();
      unsubscribeSaleCosts();
      unsubscribeRepairs();
      unsubscribeRepairCosts();
      unsubscribeExpenses();
      unsubscribeStore();
    };
  }, [ownerId, isAdmin, canViewBuyPrice, canViewMargin]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveModal(null);
      }
    };
    if (activeModal) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeModal]);

  const currency = 'DT'; // Configured specifically to Tunisian Dinar

  // Create a product lookup map for buyPrice calculation
  const productBuyPriceMap = useMemo(() => {
    const map: Record<string, number> = {};
    if (canViewBuyPrice) products.forEach(p => { map[p.id] = p.buyPrice || 0; });
    return map;
  }, [products, canViewBuyPrice]);

  // Safe Date Helper
  const getSaleDate = (sale: Sale) => {
    if (!sale.date) return new Date();
    if (typeof sale.date.toDate === 'function') return sale.date.toDate();
    if (sale.date instanceof Date) return sale.date;
    return new Date(sale.date);
  };

  // Standard group calculate for Today's Stats card summary
  const dashboardData = useMemo(() => {
    const today = new Date();

    const isSameDayRobust = (d1: Date, d2: Date) => {
      return d1.getFullYear() === d2.getFullYear() &&
             d1.getMonth() === d2.getMonth() &&
             d1.getDate() === d2.getDate();
    };
    
    // 1. Today's Sales
    const todaySales = sales.filter(s => {
      const sDate = getSaleDate(s);
      return isSameDayRobust(sDate, today);
    });

    // Today's Supplies / Expenses
    const getDate = (value: any) => value?.toDate ? value.toDate() : value instanceof Date ? value : new Date(value || 0);
    const todayExpenses = expenses.filter(expense => isSameDayRobust(getDate(expense.date), today));
    const dailyExpenses = todayExpenses.reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0);

    // 2. Chiffre d'affaires
    const dailyRevenue = todaySales.reduce((sum, sale) => sum + (Number(sale.total) || 0), 0);

    // 3. Paid & Debt
    const dailyPaid = todaySales.reduce((sum, s) => sum + s.paid, 0);
    const dailyDebt = todaySales.reduce((sum, s) => sum + s.debt, 0);

    // 4. Benefice Net
    const saleMargins = todaySales.map(sale => computeSaleProfit(sale, saleCostSnapshots[sale.id]));
    const todayRepairs = isAdmin ? repairs.filter(repair =>
      repair.status === 'livre' && isSameDayRobust(getDate(repair.deliveredAt || repair.date), today)
    ) : [];
    let repairProfit = 0;
    let repairCostsComplete = true;
    todayRepairs.forEach(repair => {
      const costs = repairCostSnapshots[repair.id] || {};
      let partCost = 0;
      (repair.parts || []).forEach((part: any) => {
        const unitBuyPrice = costs[part.productId] ?? part.unitBuyPrice;
        if (typeof unitBuyPrice !== 'number' || !Number.isFinite(unitBuyPrice)) repairCostsComplete = false;
        else partCost += unitBuyPrice * (Number(part.quantity) || 0);
      });
      const totals = computeTotals([
        { total: Number(repair.laborCost) || 0 },
        ...(repair.parts || []).map((part: any) => ({ total: Number(part.total) || 0 })),
      ], Number(repair.discount) || 0, {
        tvaEnabled: repair.tvaEnabled === true,
        tva: repair.tvaRate,
      });
      repairProfit += totals.taxableAmount - partCost;
    });
    const dailyProfit = canViewMargin && saleMargins.every(item => item.complete) && repairCostsComplete
      ? saleMargins.reduce((sum, item) => sum + (item.profit || 0), 0) + repairProfit - dailyExpenses
      : null;

    // 5. Products sold TODAY
    const productCounts: Record<string, { name: string, count: number, total: number }> = {};
    todaySales.forEach(sale => {
      sale.items.forEach(item => {
        if (!productCounts[item.productId]) {
          productCounts[item.productId] = { name: item.name, count: 0, total: 0 };
        }
        productCounts[item.productId].count += item.quantity;
        productCounts[item.productId].total += item.total;
      });
    });

    const topProductsToday = Object.values(productCounts)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // 6. Low stock alerts based on store settings minimum threshold
    const configuredMinStock = (storeSettings?.minStockAlert !== undefined && storeSettings.minStockAlert >= 0)
      ? storeSettings.minStockAlert
      : 5;

    const lowStockAlerts = products.filter(p => {
      if (p.inventoryType === 'service') return false;
      const effectiveThreshold = (p.lowStockAlert !== undefined && p.lowStockAlert >= 0)
        ? p.lowStockAlert
        : configuredMinStock;
      return p.stock <= effectiveThreshold;
    });

    return {
      dailyRevenue,
      dailyPaid,
      dailyDebt,
      dailyProfit,
      dailyExpenses,
      todaySalesCount: todaySales.length,
      topProductsToday,
      lowStockAlerts,
      todaySales,
      configuredMinStock
    };
  }, [sales, products, productBuyPriceMap, saleCostSnapshots, repairs, repairCostSnapshots, expenses, storeSettings, canViewBuyPrice, canViewMargin, isAdmin]);

  const financialSummary = useMemo(() => computeWorkshopSummary(
    sales,
    repairs,
    expenses,
    saleCostSnapshots,
    repairCostSnapshots,
    financialPeriod,
    canViewMargin,
  ), [sales, repairs, expenses, saleCostSnapshots, repairCostSnapshots, financialPeriod, canViewMargin]);

  const todaySummary = useMemo(() => computeWorkshopSummary(
    sales,
    repairs,
    expenses,
    saleCostSnapshots,
    repairCostSnapshots,
    'today',
    canShowMargin,
  ), [sales, repairs, expenses, saleCostSnapshots, repairCostSnapshots, canShowMargin]);

  const sevenDaySummaries = useMemo(() => {
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    return Array.from({ length: 7 }, (_, index) => {
      const start = new Date(today);
      start.setDate(today.getDate() - (6 - index));
      const end = new Date(start);
      end.setHours(23, 59, 59, 999);

      const daySales = sales.filter(sale => {
        const saleDate = getSaleDate(sale);
        return saleDate >= start && saleDate <= end;
      });
      const dayRepairs = repairs.filter(repair => {
        const value = repair.deliveredAt || repair.date;
        const repairDate = value?.toDate ? value.toDate() : value instanceof Date ? value : new Date(value || 0);
        return repairDate >= start && repairDate <= end;
      });
      const dayExpenses = expenses.filter(expense => {
        const value = expense.date;
        const expenseDate = value?.toDate ? value.toDate() : value instanceof Date ? value : new Date(value || 0);
        return expenseDate >= start && expenseDate <= end;
      });

      const summary = computeWorkshopSummary(
        daySales,
        dayRepairs,
        dayExpenses,
        saleCostSnapshots,
        repairCostSnapshots,
        'all',
        canShowMargin,
        end,
      );
      return {
        date: start,
        netProfit: summary.netProfit,
      };
    });
  }, [sales, repairs, expenses, saleCostSnapshots, repairCostSnapshots, canShowMargin]);

  const periodSales = useMemo(
    () => sales.filter(sale => isWithinReportPeriod(sale.date, financialPeriod)),
    [sales, financialPeriod],
  );
  const periodSalesSummary = useMemo(() => computeWorkshopSummary(
    sales,
    [],
    [],
    saleCostSnapshots,
    {},
    financialPeriod,
    false,
  ), [sales, saleCostSnapshots, financialPeriod]);
  const periodSalesCollected = periodSalesSummary.collected;
  const periodSalesCost = useMemo(() => {
    if (!canShowMargin) return null;
    const margins = periodSales.map(sale => computeSaleProfit(sale, saleCostSnapshots[sale.id]));
    return margins.every(result => result.complete)
      ? margins.reduce((sum, result) => sum + result.cost, 0)
      : null;
  }, [periodSales, saleCostSnapshots, canShowMargin]);
  const activeRepairCount = isAdmin
    ? repairs.filter(repair => !['livre', 'irreparable', 'annule'].includes(repair.status)).length
    : null;
  const repairsToDeliver = isAdmin ? repairs.filter(repair => repair.status === 'termine').length : null;
  const clientsWithDebt = new Set(sales
    .filter(sale => Number(sale.debt) > 0)
    .map(sale => sale.clientId || sale.clientName)
    .filter(Boolean)).size;

  // Group ALL sales chronologically by day to build historical statistics dynamically
  const dailyRecords = useMemo(() => {
    const dailyMap: Record<string, {
      dateStr: string; // YYYY-MM-DD
      dateObj: Date;
      revenue: number;
      profit: number;
      profitComplete: boolean;
      debt: number;
      salesCount: number;
      cashAmount: number;
    }> = {};

    const getDayKey = (date: Date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    const getOrCreate = (date: Date) => {
      const dayKey = getDayKey(date);
      if (!dailyMap[dayKey]) {
        dailyMap[dayKey] = {
          dateStr: dayKey,
          dateObj: date,
          revenue: 0,
          profit: 0,
          profitComplete: true,
          debt: 0,
          salesCount: 0,
          cashAmount: 0,
        };
      }
      return dailyMap[dayKey];
    };

    sales.forEach(sale => {
      const sDate = getSaleDate(sale);
      const record = getOrCreate(sDate);
      const margin = computeSaleProfit(sale, saleCostSnapshots[sale.id]);
      record.revenue += margin.revenueExcludingTax;
      if (margin.profit === null) record.profitComplete = false;
      else record.profit += margin.profit;
      record.debt += sale.debt || 0;
      record.salesCount += 1;
      record.cashAmount += sale.paid || 0;
    });

    if (isAdmin) {
      repairs.filter(repair => repair.status === 'livre').forEach(repair => {
        const dateValue = repair.deliveredAt || repair.date;
        const date = dateValue?.toDate ? dateValue.toDate() : new Date(dateValue || 0);
        const record = getOrCreate(date);
        const costs = repairCostSnapshots[repair.id] || {};
        let partsCost = 0;
        (repair.parts || []).forEach((part: any) => {
          const buyPrice = costs[part.productId] ?? part.unitBuyPrice;
          if (typeof buyPrice !== 'number' || !Number.isFinite(buyPrice)) record.profitComplete = false;
          else partsCost += buyPrice * (Number(part.quantity) || 0);
        });
        const totals = computeTotals([
          { total: Number(repair.laborCost) || 0 },
          ...(repair.parts || []).map((part: any) => ({ total: Number(part.total) || 0 })),
        ], Number(repair.discount) || 0, {
          tvaEnabled: repair.tvaEnabled === true,
          tva: repair.tvaRate,
        });
        record.revenue += totals.taxableAmount;
        record.profit += totals.taxableAmount - partsCost;
        record.debt += Number(repair.debt) || 0;
        record.cashAmount += Number(repair.paid) || 0;
      });
      expenses.forEach(expense => {
        const value = expense.date?.toDate ? expense.date.toDate() : new Date(expense.date || 0);
        const record = getOrCreate(value);
        record.profit -= Number(expense.amount) || 0;
      });
      expenses.forEach(expense => {
        const value = expense.date?.toDate ? expense.date.toDate() : new Date(expense.date || 0);
        const record = getOrCreate(value);
        record.profit -= Number(expense.amount) || 0;
      });
    }

    return Object.values(dailyMap);
  }, [sales, saleCostSnapshots, repairs, repairCostSnapshots, expenses, isAdmin]);

  // Group ALL supplies chronologically by day to build historical expenses statistics dynamically
  const dailySuppliesRecords = useMemo(() => {
    const dailyMap: Record<string, {
      dateStr: string; // YYYY-MM-DD
      dateObj: Date;
      productsCount: number; // unique operations or product additions count
      totalQty: number;      // total items added
      totalExpenses: number; // total cost of purchases
    }> = {};

    supplies.forEach(sup => {
      const sDate = !sup.date ? new Date() : (typeof sup.date.toDate === 'function' ? sup.date.toDate() : new Date(sup.date));
      const year = sDate.getFullYear();
      const month = String(sDate.getMonth() + 1).padStart(2, '0');
      const day = String(sDate.getDate()).padStart(2, '0');
      const dayKey = `${year}-${month}-${day}`;

      if (!dailyMap[dayKey]) {
        dailyMap[dayKey] = {
          dateStr: dayKey,
          dateObj: sDate,
          productsCount: 0,
          totalQty: 0,
          totalExpenses: 0
        };
      }

      const record = dailyMap[dayKey];
      record.productsCount += 1;
      record.totalQty += (sup.quantity || 0);
      record.totalExpenses += (sup.totalCost || 0);
    });

    return Object.values(dailyMap).sort((a, b) => b.dateStr.localeCompare(a.dateStr));
  }, [supplies]);

  // Handle Search & Filter & Sorter for the Active Historical Data
  const filteredAndSortedRecords = useMemo(() => {
    let result = [...dailyRecords];

    // 1. Searching by Date
    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase();
      result = result.filter(rec => {
        const formatted = rec.dateObj.toLocaleDateString(getDateLocale()); // ex: "22/06/2026"
        return formatted.toLowerCase().includes(q) || rec.dateStr.includes(q);
      });
    }

    // 2. Period Filter
    const todayLimit = new Date();
    todayLimit.setHours(23, 59, 59, 999);

    if (periodFilter === 'today') {
      const boundary = new Date();
      boundary.setHours(0, 0, 0, 0);
      result = result.filter(rec => rec.dateObj >= boundary);
    } else if (periodFilter === '7') {
      const boundary = new Date();
      boundary.setDate(todayLimit.getDate() - 6);
      result = result.filter(rec => rec.dateObj >= boundary);
    } else if (periodFilter === '30') {
      const boundary = new Date();
      boundary.setDate(todayLimit.getDate() - 29);
      result = result.filter(rec => rec.dateObj >= boundary);
    } else if (periodFilter === '90') {
      const boundary = new Date();
      boundary.setDate(todayLimit.getDate() - 89);
      result = result.filter(rec => rec.dateObj >= boundary);
    } else if (periodFilter === 'year') {
      const boundary = new Date(todayLimit.getFullYear(), 0, 1);
      result = result.filter(rec => rec.dateObj >= boundary);
    } else if (periodFilter === 'custom') {
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        result = result.filter(rec => rec.dateObj >= start);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        result = result.filter(rec => rec.dateObj <= end);
      }
    }

    // 3. Sorting
    result.sort((a, b) => {
      let comparison = 0;
      if (sortField === 'date') {
        comparison = a.dateObj.getTime() - b.dateObj.getTime();
      } else {
        // Sort by value depending on current context
        const valA = activeModal === 'revenue' ? a.revenue
          : activeModal === 'profit' ? a.profit
          : activeModal === 'debt' ? a.debt
          : a.salesCount;
        const valB = activeModal === 'revenue' ? b.revenue
          : activeModal === 'profit' ? b.profit
          : activeModal === 'debt' ? b.debt
          : b.salesCount;
        comparison = valA - valB;
      }
      return sortAsc ? comparison : -comparison;
    });

    return result;
  }, [dailyRecords, searchQuery, periodFilter, startDate, endDate, sortField, sortAsc, activeModal]);

  // Remaining Stock valuation and profit margins calculations - automatically refreshed in real-time
  const stockValuation = useMemo(() => {
    let totalItemsCount = 0;
    let inStockItemsCount = 0; // Produits réellement existants en stock (quantité > 0)
    let totalStockQty = 0;
    let totalBuyValue = 0;
    let totalSellValue = 0; // Estimated revenues
    
    products.forEach(p => {
      const stock = p.stock || 0;
      totalItemsCount += 1;
      if (stock > 0) inStockItemsCount += 1;
      totalStockQty += stock;
      if (canViewBuyPrice) totalBuyValue += stock * (p.buyPrice || 0);
      totalSellValue += stock * (p.sellPrice || 0);
    });
    
    const theoreticalMargin = canViewMargin ? totalSellValue - totalBuyValue : 0;
    const marginRatio = canViewMargin && totalSellValue > 0 ? (theoreticalMargin / totalSellValue) * 100 : 0;
    
    return {
      totalItemsCount,
      inStockItemsCount,
      outOfStockCount: totalItemsCount - inStockItemsCount,
      totalStockQty,
      totalBuyValue,
      totalSellValue,
      theoreticalMargin,
      marginRatio
    };
  }, [products, canViewBuyPrice, canViewMargin]);

  const filteredAndSortedProducts = useMemo(() => {
    if (activeModal !== 'stock') return [];
    let result = [...products];

    // 1. Searching by Product Name or Barcode or Category
    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase();
      result = result.filter(p => 
        (p.name || '').toLowerCase().includes(q) ||
        (p.barcode || '').toLowerCase().includes(q) ||
        (p.category || '').toLowerCase().includes(q)
      );
    }

    // 2. Sorting
    result.sort((a, b) => {
      let comparison = 0;
      if (sortField === 'date') {
        // Sort by name for 'date' field in stock modal context
        comparison = (a.name || '').localeCompare(b.name || '');
      } else {
        // Sort by total stock valuation (sell price) or stock level
        const stockValA = (a.stock || 0) * (a.sellPrice || 0);
        const stockValB = (b.stock || 0) * (b.sellPrice || 0);
        comparison = stockValA - stockValB;
      }
      return sortAsc ? comparison : -comparison;
    });

    return result;
  }, [products, searchQuery, sortField, sortAsc, activeModal]);

  // Paginated records list
  const paginatedRecords = useMemo(() => {
    const startIdx = (currentPage - 1) * itemsPerPage;
    if (activeModal === 'stock') {
      return filteredAndSortedProducts.slice(startIdx, startIdx + itemsPerPage);
    }
    return filteredAndSortedRecords.slice(startIdx, startIdx + itemsPerPage);
  }, [filteredAndSortedRecords, filteredAndSortedProducts, currentPage, activeModal]);

  const totalPages = useMemo(() => {
    if (activeModal === 'stock') {
      return Math.ceil(filteredAndSortedProducts.length / itemsPerPage);
    }
    return Math.ceil(filteredAndSortedRecords.length / itemsPerPage);
  }, [filteredAndSortedRecords, filteredAndSortedProducts, activeModal]);

  // Excel (.xlsx) sheets generator
  const handleExportHistory = () => {
    try {
      if (activeModal === 'stock') {
        if (filteredAndSortedProducts.length === 0) {
          alert("Aucun enregistrement à exporter.");
          return;
        }

        const rows = filteredAndSortedProducts.map(p => {
          const stock = p.stock || 0;
          const buyValue = canViewBuyPrice ? stock * (p.buyPrice || 0) : 0;
          const sellValue = stock * (p.sellPrice || 0);
          const theoreticalMargin = canViewMargin ? sellValue - buyValue : 0;
          const ratio = canViewMargin && sellValue > 0 ? ((theoreticalMargin / sellValue) * 100).toFixed(1) + '%' : '0.0%';
          return {
            'Désignation du Produit': p.name || '',
            'Code barre': p.barcode || 'Sans codebarre',
            'Catégorie': p.category || 'Général',
            'Quantité en stock': stock,
            'Prix de vente unitaire (DT)': (p.sellPrice || 0).toFixed(3),
            'Valeur de vente totale (Revenus) (DT)': sellValue.toFixed(3),
            ...(canViewBuyPrice ? {
              'Prix d\'achat unitaire (DT)': (p.buyPrice || 0).toFixed(3),
              'Valeur d\'achat totale (DT)': buyValue.toFixed(3),
            } : {}),
            ...(canViewMargin ? {
              'Marge théorique estimée (DT)': theoreticalMargin.toFixed(3),
              'Ratio Marge (%)': ratio,
            } : {}),
          };
        });

        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();

        // Feuille de synthèse : état instantané du stock
        const now = new Date();
        const summaryRows = [
          { 'Indicateur': 'Date et heure du calcul', 'Valeur': `${now.toLocaleDateString(getDateLocale())} ${now.toLocaleTimeString(getDateLocale(), { hour: '2-digit', minute: '2-digit' })}` },
          { 'Indicateur': 'Produits existants en stock (quantité > 0)', 'Valeur': stockValuation.inStockItemsCount },
          { 'Indicateur': 'Références totales répertoriées', 'Valeur': stockValuation.totalItemsCount },
          { 'Indicateur': 'Produits en rupture de stock', 'Valeur': stockValuation.outOfStockCount },
          { 'Indicateur': 'Quantité totale en stock (unités)', 'Valeur': stockValuation.totalStockQty },
          { 'Indicateur': `Valeur du stock à cet instant — Vente potentielle (${currency})`, 'Valeur': stockValuation.totalSellValue.toFixed(3) },
          ...(canViewBuyPrice ? [
            { 'Indicateur': `Valeur du stock à cet instant — Achat (${currency})`, 'Valeur': stockValuation.totalBuyValue.toFixed(3) },
          ] : []),
          ...(canViewMargin ? [
            { 'Indicateur': `Marge théorique estimée (${currency})`, 'Valeur': stockValuation.theoreticalMargin.toFixed(3) },
            { 'Indicateur': 'Taux de marge moyen (%)', 'Valeur': stockValuation.marginRatio.toFixed(1) + '%' }
          ] : [])
        ];
        const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
        wsSummary['!cols'] = [{ wch: 48 }, { wch: 24 }];
        XLSX.utils.book_append_sheet(wb, wsSummary, 'Synthèse');

        XLSX.utils.book_append_sheet(wb, ws, 'Valorisation Stock');
        XLSX.writeFile(wb, `${slugifyAppName(brand.storeName)}-rapport-valorisation-stock_${new Date().toISOString().split('T')[0]}.xlsx`);
        return;
      }

      if (filteredAndSortedRecords.length === 0) {
        alert("Aucun enregistrement à exporter.");
        return;
      }

      const rows = filteredAndSortedRecords.map(rec => {
        const fmtDate = rec.dateObj.toLocaleDateString(getDateLocale());
        if (activeModal === 'revenue') {
          return {
            'Date': fmtDate,
            'Nombre de Ventes': rec.salesCount,
            'Total Encaissé (DT)': rec.cashAmount.toFixed(3),
            'Dettes Générées (DT)': rec.debt.toFixed(3),
            'Chiffre d\'Affaires (DT)': rec.revenue.toFixed(3)
          };
        } else if (activeModal === 'profit') {
          const ratio = rec.profitComplete && rec.revenue > 0 ? ((rec.profit / rec.revenue) * 100).toFixed(1) + '%' : '—';
          return {
            'Date': fmtDate,
            'Chiffre d\'Affaires (DT)': rec.revenue.toFixed(3),
            'Coûts et dépenses (DT)': rec.profitComplete ? (rec.revenue - rec.profit).toFixed(3) : 'Coûts manquants',
            'Marge Ratio (%)': ratio,
            'Bénéfice Net (DT)': rec.profitComplete ? rec.profit.toFixed(3) : 'Coûts manquants'
          };
        } else if (activeModal === 'debt') {
          return {
            'Date': fmtDate,
            'Chiffre d\'Affaires (DT)': rec.revenue.toFixed(3),
            'Montant Payé (DT)': rec.cashAmount.toFixed(3),
            'Transactions total': rec.salesCount,
            'Total des Impayés (DT)': rec.debt.toFixed(3)
          };
        } else {
          return {
            'Date': fmtDate,
            'Tickets encaissés': rec.salesCount,
            'Panier Moyen (DT)': rec.salesCount > 0 ? (rec.revenue / rec.salesCount).toFixed(3) : '0.000',
            'Nombre total Transactions': rec.salesCount
          };
        }
      });

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      
      let tabName = 'Chiffre d\'Affaires';
      if (activeModal === 'profit') tabName = 'Bénéfice Net';
      else if (activeModal === 'debt') tabName = 'Dettes';
      else if (activeModal === 'sales') tabName = 'Transactions';

      XLSX.utils.book_append_sheet(wb, ws, tabName.slice(0, 30));
      XLSX.writeFile(wb, `${slugifyAppName(brand.storeName)}-rapport-caisse-${tabName.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`);
    } catch (e) {
      console.error(e);
      alert("Une erreur est survenue lors de l'exportation vers Excel.");
    }
  };

  const openHistoryModal = (type: 'revenue' | 'profit' | 'debt' | 'sales' | 'expenses' | 'stock') => {
    if (!canViewMargin && type === 'profit') return;
    setActiveModal(type);
    setSearchQuery('');
    setPeriodFilter('30');
    setStartDate('');
    setEndDate('');
    setSortField('date');
    setSortAsc(false); // Newest first by default
    setCurrentPage(1);
    setExpensesTab('daily');
    setExpensesSearch('');
    setExpensesPage(1);
  };

  const filteredSupplies = useMemo(() => {
    let result = [...supplies];
    if (expensesSearch.trim() !== '') {
      const q = expensesSearch.toLowerCase();
      result = result.filter(sup => 
        (sup.productName || '').toLowerCase().includes(q) ||
        (sup.date && typeof sup.date.toDate === 'function' && sup.date.toDate().toLocaleDateString(getDateLocale()).includes(q))
      );
    }
    return result;
  }, [supplies, expensesSearch]);

  const paginatedSupplies = useMemo(() => {
    const start = (expensesPage - 1) * expensesItemsPerPage;
    return filteredSupplies.slice(start, start + expensesItemsPerPage);
  }, [filteredSupplies, expensesPage]);

  const totalExpensesPages = Math.ceil(filteredSupplies.length / expensesItemsPerPage);

  const exportExpensesToExcel = () => {
    try {
      let rows: any[] = [];
      let filename = '';
      if (expensesTab === 'daily') {
        rows = dailySuppliesRecords.map(rec => ({
          'Date': rec.dateObj.toLocaleDateString(getDateLocale()),
          'Nombre de produits ajoutés': rec.productsCount,
          'Quantité totale ajoutée': rec.totalQty,
          'Dépenses totales (DT)': rec.totalExpenses.toFixed(3)
        }));
        filename = `Depenses_Journalieres`;
      } else {
        rows = supplies.map(sup => {
          const timestampStr = !sup.date ? '' : (typeof sup.date.toDate === 'function' ? sup.date.toDate().toLocaleString(getDateLocale()) : new Date(sup.date).toLocaleString(getDateLocale()));
          return {
            'Date et Heure': timestampStr,
            'Produit': sup.productName || '',
            'Quantité Ajoutée': sup.quantity || 0,
            'Prix d\'achat unitaire (DT)': (sup.buyPrice || 0).toFixed(3),
            'Coût Total (DT)': (sup.totalCost || 0).toFixed(3)
          };
        });
        filename = `Details_Depenses`;
      }

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Dépenses');
      XLSX.writeFile(wb, `${slugifyAppName(brand.storeName)}-${filename}_${new Date().toISOString().split('T')[0]}.xlsx`);
    } catch (e) {
      console.error(e);
      alert("Une erreur est survenue lors de l'exportation vers Excel.");
    }
  };

  const handleUpdateSupply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSupply) return;
    try {
      const newQty = parseInt(editingSupplyQty) || 0;
      const newPrice = parseFloat(editingSupplyPrice) || 0;
      if (newQty <= 0) return;

      const oldQty = editingSupply.quantity || 0;
      const quantityDiff = newQty - oldQty;

      // 1. Update matching product stock reference in Firestore
      if (editingSupply.productId) {
        const prodRef = doc(db, 'products', editingSupply.productId);
        const matchingProd = products.find(p => p.id === editingSupply.productId);
        if (matchingProd) {
          const updatedStock = Math.max(0, (matchingProd.stock || 0) + quantityDiff);
          await updateDoc(prodRef, { 
            stock: updatedStock,
            buyPrice: newPrice 
          });
        }
      }

      // 2. Update supply document in Firestore
      await updateDoc(doc(db, 'supplies', editingSupply.id), {
        quantity: newQty,
        buyPrice: newPrice,
        totalCost: newQty * newPrice
      });

      setEditingSupply(null);
    } catch (err) {
      console.error('Error updating supply:', err);
      alert('Erreur lors de la modification de l\'approvisionnement.');
    }
  };

  const handleDeleteSupply = async (supply: any) => {
    if (!window.confirm(`Voulez-vous vraiment supprimer cet approvisionnement pour "${supply.productName}" ?`)) return;
    try {
      // 1. Subtract supply quantity from product stock
      if (supply.productId) {
        const prodRef = doc(db, 'products', supply.productId);
        const matchingProd = products.find(p => p.id === supply.productId);
        if (matchingProd) {
          const updatedStock = Math.max(0, (matchingProd.stock || 0) - (supply.quantity || 0));
          await updateDoc(prodRef, { stock: updatedStock });
        }
      }

      // 2. Delete the supply doc
      await deleteDoc(doc(db, 'supplies', supply.id));
    } catch (err) {
      console.error('Error deleting supply:', err);
      alert('Erreur lors de la suppression.');
    }
  };

  const financialCards = [
    { label: 'Ventes encaissées', value: periodSalesCollected, unit: currency, icon: Wallet, count: false },
    ...(canShowMargin ? [
      { label: "Coût d'achat", value: periodSalesCost, unit: currency, icon: Package, count: false },
    ] : []),
    { label: 'Impayés', value: financialSummary.debt, unit: currency, icon: AlertCircle, count: false },
    { label: 'Réparations en cours', value: activeRepairCount, unit: 'réparations', icon: Wrench, count: true },
  ];
  const historicalTvaSalesCount = sales.filter(sale => Number(sale.tva) > 0).length;

  if (loading) return (
    <div role="status" aria-label="Chargement des indicateurs" className="flex min-h-[60vh] min-w-0 flex-col items-center justify-center gap-4">
      <span className="sr-only">Chargement des indicateurs...</span>
      <div className="grid w-full max-w-6xl grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="h-28 animate-pulse rounded-ds-lg border border-ds-border bg-ds-surface" />
        ))}
      </div>
      <div className="h-64 w-full max-w-6xl animate-pulse rounded-ds-lg border border-ds-border bg-ds-surface" />
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-[1680px] min-w-0 space-y-6 pb-12 [&_button]:min-h-11 sm:space-y-8 xl:space-y-10">
      <PageHeader
        title="Tableau de bord"
        description={canViewSales ? 'Performance financière et opérationnelle en temps réel' : 'Suivi opérationnel en temps réel'}
        className="border-b border-ds-border pb-5"
        actions={<div className="flex min-w-0 flex-wrap items-center gap-2">
          {dashboardData.lowStockAlerts.length > 0 && stockAlertDismissed && (
            <button
              type="button"
              onClick={() => setStockAlertDismissed(false)}
              className="flex min-h-11 items-center gap-1.5 rounded-full border border-ds-danger bg-ds-danger-soft px-4 py-2 text-xs font-black text-ds-danger transition-colors hover:bg-ds-danger-soft"
              title="Cliquer pour afficher la notification d'alerte de stock"
            >
              <AlertTriangle className="h-3.5 w-3.5 text-ds-danger" />
              <span>{dashboardData.lowStockAlerts.length} alerte{dashboardData.lowStockAlerts.length > 1 ? 's' : ''} de stock (Afficher)</span>
            </button>
          )}
          <div className="flex min-h-11 items-center gap-2 rounded-ds-md border border-ds-border bg-ds-surface px-4 py-2 text-xs font-semibold text-ds-muted">
            <Calendar className="h-4 w-4 text-ds-brand" />
            <span>Aujourd'hui, {new Date().toLocaleDateString(getDateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}</span>
          </div>
        </div>}
      />

      <section className="hidden">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-ds-brand-contrast/90">Bénéfice net, aujourd'hui</p>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-display text-[62px] font-bold leading-none tracking-[-0.06em] tabular-nums lg:text-[104px]">
              {canShowMargin && todaySummary.netProfit !== null ? todaySummary.netProfit.toFixed(3) : '—'}
            </span>
            {canShowMargin && todaySummary.netProfit !== null && (
              <span className="text-xl font-semibold text-ds-brand-contrast/90">{currency}</span>
            )}
          </div>
          {canShowMargin && (
            <div className="mt-6 flex flex-wrap gap-2">
              <span className="rounded-full border border-ds-brand-contrast/25 bg-ds-surface/10 px-4 py-2 text-xs font-semibold text-ds-brand-contrast">
                Bénéfice brut <span className="ms-1 font-display tabular-nums">{todaySummary.grossProfit === null ? '—' : `${todaySummary.grossProfit.toFixed(3)} ${currency}`}</span>
              </span>
              <span className="rounded-full border border-ds-brand-contrast/25 bg-ds-surface/10 px-4 py-2 text-xs font-semibold text-ds-brand-contrast">
                Dépenses <span className="ms-1 font-display tabular-nums">{todaySummary.expenses.toFixed(3)} {currency}</span>
              </span>
            </div>
          )}
          {canShowMargin && todaySummary.netProfit === null && (
            <p role="status" className="mt-4 max-w-xl text-xs leading-5 text-ds-brand-contrast/90">
              Bénéfice masqué : des coûts historiques sont manquants. Aucun coût estimé n’est utilisé.
            </p>
          )}
        </div>
        <div className="min-w-0">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-ds-brand-contrast/90">Bénéfice net · 7 jours</p>
            {canShowMargin && <span className="text-[10px] text-ds-brand-contrast/75">Derniers jours</span>}
          </div>
          <div className="flex h-24 items-end gap-2" role="img" aria-label="Graphique du bénéfice net sur les sept derniers jours">
            {sevenDaySummaries.map(({ date, netProfit }) => {
              const maxProfit = Math.max(1, ...sevenDaySummaries.map(day => Math.abs(day.netProfit || 0)));
              const height = netProfit === null ? 8 : Math.max(8, Math.abs(netProfit) / maxProfit * 100);
              return (
                <div key={date.toISOString()} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
                  <div
                    className={cn(
                      'w-full rounded-t-md',
                      !canShowMargin || netProfit === null ? 'bg-ds-surface-2' :
                        netProfit < 0 ? 'bg-ds-danger' : 'bg-ds-surface',
                    )}
                    style={{ height: `${height}%` }}
                    title={`${date.toLocaleDateString(getDateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })} : ${netProfit === null ? 'indisponible' : `${netProfit.toFixed(3)} ${currency}`}`}
                  />
                  <span className="text-[10px] font-semibold capitalize text-ds-brand-contrast/80">
                    {date.toLocaleDateString(getDateLocale(), { weekday: 'short' }).replace('.', '')}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-black uppercase tracking-wider text-ds-text">Synthèse financière</h2>
          <div className="flex max-w-full gap-1 overflow-x-auto rounded-full border border-ds-border bg-ds-surface p-1" role="group" aria-label="Période de la synthèse financière">
            {([
              ['today', "Aujourd'hui"],
              ['7', '7 jours'],
              ['30', '30 jours'],
              ['90', '90 jours'],
              ['year', 'Cette année'],
              ['all', 'Tout'],
            ] as const).map(([period, label]) => (
              <button
                key={period}
                type="button"
                aria-pressed={financialPeriod === period}
                onClick={() => setFinancialPeriod(period)}
                className={cn(
                  'min-h-11 shrink-0 rounded-full px-4 text-xs font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:ring-ds-brand',
                  financialPeriod === period ? 'bg-ds-brand text-ds-brand-contrast' : 'text-ds-muted hover:bg-ds-surface-2',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className={cn('grid grid-cols-1 gap-3 sm:grid-cols-2', canShowMargin ? 'xl:grid-cols-4' : 'lg:grid-cols-3')}>
          {financialCards.map(({ label, value, unit, icon: Icon, count }, index) => {
            const accent = ['var(--ds-brand)', 'var(--ds-accent)', 'var(--ds-danger)', 'var(--ds-info)'][index % 4];
            return (
            <article
              key={label}
              className="stat-card flex min-h-32 min-w-0 items-center justify-between p-4 sm:p-5"
              style={{ '--stat-accent': accent } as React.CSSProperties}
            >
              <div className="min-w-0">
                <p className="stat-label">{label}</p>
                <p className="stat-value mt-2 break-words text-ds-text">
                  {value === null ? '—' : count ? value : value.toFixed(3)}
                  {value !== null && <span className="ms-1 text-xs font-semibold text-ds-muted">{unit}</span>}
                </p>
              </div>
              <span className="stat-icon shrink-0" style={{ '--stat-accent': accent } as React.CSSProperties}>
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
            </article>
            );
          })}
        </div>
        {canShowMargin && (
          <div className="rounded-[18px] border border-ds-border bg-ds-surface px-4 py-3 text-xs text-ds-muted">
            <strong>CA réparations :</strong> main-d’œuvre {financialSummary.laborRevenue.toFixed(3)} {currency}
            {' · '}pièces facturées {financialSummary.repairPartsRevenue.toFixed(3)} {currency}
            {' · '}coût des pièces {financialSummary.repairPartsCost.toFixed(3)} {currency}
            {' · '}{financialSummary.salesWithTva} vente(s) avec TVA sur la période
            {' · '}historique total : {historicalTvaSalesCount} vente(s) avec TVA
            {(financialSummary.incompleteSales > 0 || financialSummary.incompleteRepairs > 0) && (
              <p role="status" className="mt-2 font-semibold text-ds-danger">
                Bénéfice masqué : coûts historiques manquants pour {financialSummary.incompleteSales} vente(s)
                {financialSummary.incompleteRepairs ? ' ou certaines réparations' : ''}. Aucun coût estimé n’est utilisé.
              </p>
            )}
          </div>
        )}
      </section>

      <section className={cn('grid min-w-0 grid-cols-1 gap-4 xl:gap-6', canAccessCashSession && 'lg:grid-cols-2')}>
        {canAccessCashSession && <Card className="min-w-0 rounded-ds-lg p-5 sm:p-6 xl:p-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-display text-lg font-bold text-ds-text">Caisse en cours</h2>
              <p className="mt-1 text-xs text-ds-muted">
                {cashSession ? 'Session ouverte' : 'Aucune caisse ouverte'}
              </p>
            </div>
            <Wallet className="h-5 w-5 text-ds-muted" aria-hidden="true" />
          </div>
          {cashSession ? (
            <>
              <div className="mt-5 space-y-3 text-sm">
                <div className="flex justify-between gap-4">
                  <span className="text-ds-muted">Fond de caisse</span>
                  <span className="font-display font-semibold tabular-nums text-ds-text">{Number(cashSession.openingFloat || 0).toFixed(3)} {currency}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-ds-muted">Espèces encaissées</span>
                  <span className="font-display font-semibold tabular-nums text-ds-text">
                    {(
                      Number(cashSession.totals?.cash || 0) +
                      Number(cashSession.totals?.debtsCollectedCash ?? cashSession.totals?.debtsCollected ?? 0) +
                      Number(cashSession.totals?.repairsCollectedCash ?? cashSession.totals?.repairsCollected ?? 0)
                    ).toFixed(3)} {currency}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-ds-muted">Dépenses en espèces</span>
                  <span className="font-display font-semibold tabular-nums text-ds-text">−{Number(cashSession.totals?.expensesCash || 0).toFixed(3)} {currency}</span>
                </div>
                <div className="flex justify-between gap-4 border-t border-ds-border pt-3">
                  <span className="font-bold text-ds-text">Attendu en caisse</span>
                  <span className="font-display font-bold tabular-nums text-ds-text">{computeExpectedCash(cashSession).toFixed(3)} {currency}</span>
                </div>
              </div>
              {canAccessCashSession && (
                <Link to="/cash-session" className="mt-5 inline-flex min-h-11 items-center justify-center rounded-full bg-ds-brand px-5 text-sm font-bold text-ds-brand-contrast transition-colors hover:bg-ds-brand-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:ring-ds-brand">
                  Clôturer la caisse
                </Link>
              )}
            </>
          ) : (
            canAccessCashSession && (
              <Link to="/cash-session" className="mt-5 inline-flex min-h-11 items-center justify-center rounded-full border border-ds-border bg-ds-surface px-5 text-sm font-bold text-ds-text transition-colors hover:bg-ds-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:ring-ds-brand">
                Ouvrir la caisse
              </Link>
            )
          )}
        </Card>}

        <Card className="min-w-0 rounded-ds-lg p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-display text-lg font-bold text-ds-text">À traiter</h2>
              <p className="mt-1 text-xs text-ds-muted">Éléments nécessitant votre attention</p>
            </div>
            <AlertTriangle className="h-5 w-5 text-ds-muted" aria-hidden="true" />
          </div>
          <div className="mt-5 space-y-2">
            {hasMenuAccess(userProfile, 'pieces') && (
              <Link to="/parts" className="flex min-h-11 items-center justify-between gap-4 rounded-xl px-3 text-sm transition-colors hover:bg-ds-surface-2">
                <span className="text-ds-text">Stock faible</span>
                <span className={cn('rounded-full px-3 py-1 font-display text-xs font-bold tabular-nums', dashboardData.lowStockAlerts.length ? 'bg-ds-danger-soft text-ds-danger' : 'bg-ds-surface-2 text-ds-muted')}>
                  {dashboardData.lowStockAlerts.length}
                </span>
              </Link>
            )}
            {isAdmin && hasMenuAccess(userProfile, 'reparation') && (
              <Link to="/repairs" className="flex min-h-11 items-center justify-between gap-4 rounded-xl px-3 text-sm transition-colors hover:bg-ds-surface-2">
                <span className="text-ds-text">Réparations terminées</span>
                <span className="rounded-full bg-ds-surface-2 px-3 py-1 font-display text-xs font-bold tabular-nums text-ds-muted">{repairsToDeliver ?? '—'}</span>
              </Link>
            )}
            {canViewSales && hasMenuAccess(userProfile, 'clients') && (
              <Link to="/clients" className="flex min-h-11 items-center justify-between gap-4 rounded-xl px-3 text-sm transition-colors hover:bg-ds-surface-2">
                <span className="text-ds-text">Clients avec impayés</span>
                <span className={cn('rounded-full px-3 py-1 font-display text-xs font-bold tabular-nums', clientsWithDebt ? 'bg-ds-danger-soft text-ds-danger' : 'bg-ds-surface-2 text-ds-muted')}>
                  {clientsWithDebt}
                </span>
              </Link>
            )}
          </div>
        </Card>
      </section>

      {/* SYSTÈME D'ALERTE VISUELLE : NOTIFICATION DE STOCK MINIMUM */}
      {dashboardData.lowStockAlerts.length > 0 && !stockAlertDismissed && (
        <div className="relative min-w-0 overflow-hidden rounded-ds-lg border border-ds-warning/20 bg-ds-warning-soft p-4 transition-all sm:p-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            
            {/* Left: Icon & Details */}
            <div className="flex items-start gap-3.5">
              <div className="relative flex items-center justify-center shrink-0 mt-0.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-ds-md bg-ds-warning text-ds-brand-contrast">
                  <AlertTriangle className="w-5 h-5 animate-pulse" />
                </div>
                <span className="absolute -top-1 -end-1 flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-ds-danger-soft opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-ds-danger"></span>
                </span>
              </div>

              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-black text-ds-danger tracking-tight">
                    Alerte de Stock Faible ({dashboardData.lowStockAlerts.length} produit{dashboardData.lowStockAlerts.length > 1 ? 's' : ''})
                  </h3>
                  <Badge variant="warning" className="min-h-7 px-2 py-0.5 text-[10px] uppercase tracking-wider">
                    Seuil minimum : {dashboardData.configuredMinStock} unités
                  </Badge>
                  {dashboardData.lowStockAlerts.filter(p => p.stock <= 0).length > 0 && (
                    <Badge variant="danger" className="min-h-7 px-2 py-0.5 text-[10px] uppercase tracking-wider">
                      {dashboardData.lowStockAlerts.filter(p => p.stock <= 0).length} rupture{dashboardData.lowStockAlerts.filter(p => p.stock <= 0).length > 1 ? 's' : ''} immédiate{dashboardData.lowStockAlerts.filter(p => p.stock <= 0).length > 1 ? 's' : ''} !
                    </Badge>
                  )}
                </div>
                <p className="mt-1 text-xs font-medium text-ds-warning">
                  La quantité en stock de ces articles est inférieure ou égale au seuil minimum défini dans vos paramètres ({dashboardData.configuredMinStock} unités). Un réapprovisionnement est recommandé.
                </p>

                {/* Quick list of urgent items */}
                <div className="flex flex-wrap items-center gap-1.5 mt-3">
                  {dashboardData.lowStockAlerts.slice(0, 6).map((prod) => (
                    <div 
                      key={prod.id}
                      onClick={() => openHistoryModal('stock')}
                      className={cn(
                        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px] font-bold border transition-all cursor-pointer hover:scale-105 active:scale-95 shadow-xs",
                        prod.stock <= 0
                          ? "border-ds-danger bg-ds-danger text-ds-brand-contrast"
                          : "border-ds-warning/20 bg-ds-warning-soft text-ds-warning"
                      )}
                    >
                      <span className="truncate max-w-[140px]">{prod.name}</span>
                      <span className={cn(
                        "px-1.5 py-0.2 rounded font-mono font-black text-[10px]",
                        prod.stock <= 0 ? "bg-ds-brand-contrast/20 text-ds-brand-contrast" : "bg-ds-surface text-ds-warning"
                      )}>
                        {prod.stock} restant{prod.stock > 1 ? 's' : ''}
                      </span>
                    </div>
                  ))}
                  {dashboardData.lowStockAlerts.length > 6 && (
                    <button
                      type="button"
                      onClick={() => openHistoryModal('stock')}
                      className="ms-1 cursor-pointer text-[11px] font-bold text-ds-danger underline underline-offset-2 transition-colors hover:text-ds-danger"
                    >
                      +{dashboardData.lowStockAlerts.length - 6} autres produits...
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Right: Actions */}
            <div className="flex items-center gap-2 self-end md:self-center shrink-0">
              <Button
                type="button"
                onClick={() => openHistoryModal('stock')}
                className="rounded-full px-4 text-xs font-black uppercase tracking-wider"
              >
                <Package className="w-3.5 h-3.5" />
                <span>Gérer le Stock</span>
              </Button>
              <button
                type="button"
                onClick={() => setStockAlertDismissed(true)}
                aria-label="Masquer l'alerte de stock"
                title="Masquer l'alerte temporairement"
                className="min-h-11 min-w-11 cursor-pointer rounded-full text-ds-danger transition-colors hover:bg-ds-danger-soft"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Main Stats Grid with responsive 2-column layout and optimized sizing */}
      {canViewSales && <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 sm:gap-5 xl:gap-6">
        
        {/* CARD 1: Chiffre d'Affaires - BLEU */}
        <div 
          onClick={() => openHistoryModal('revenue')}
          className="stat-card before:hidden flex min-h-[140px] cursor-pointer flex-col justify-between border-0 bg-ds-brand p-3.5 text-ds-brand-contrast shadow-ds-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ds-brand sm:min-h-[170px] sm:p-6"
        >
          <div className="flex items-center justify-between relative z-10 gap-1">
            <span className="truncate text-xs font-black uppercase tracking-widest text-ds-brand-contrast/90 sm:text-sm">CA Jour</span>
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-ds-surface/15 sm:h-9 sm:w-9">
              <TrendingUp className="h-4 w-4 text-ds-brand-contrast sm:h-5 sm:w-5" />
            </div>
          </div>
          <div className="mt-3 sm:mt-4 relative z-10">
            <div className="flex items-baseline gap-1">
              <span className="truncate font-mono text-xl font-black leading-none tracking-tight text-ds-brand-contrast tabular-nums sm:text-[28px] lg:text-[30px]">
                {dashboardData.dailyRevenue.toFixed(3)}
              </span>
              <span className="shrink-0 text-xs font-black text-ds-brand-contrast sm:text-sm">{currency}</span>
            </div>
            <p className="mt-1.5 flex items-center gap-1 text-[10px] font-bold text-ds-brand-contrast/90 sm:mt-2.5 sm:text-xs">
              <Clock className="w-3 h-3 shrink-0" />
              <span className="truncate">Historique</span>
            </p>
          </div>
        </div>

        {canShowMargin && <div
          onClick={() => openHistoryModal('profit')}
          className="stat-card before:hidden flex min-h-[140px] cursor-pointer flex-col justify-between rounded-ds-lg border border-ds-border bg-ds-surface p-3.5 text-ds-text shadow-ds-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ds-brand sm:min-h-[170px] sm:p-6"
        >
          <div className="flex items-center justify-between relative z-10 gap-1">
            <span className="truncate text-xs font-black uppercase tracking-widest text-ds-success sm:text-sm">Bénéfice Net</span>
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-ds-success-soft sm:h-9 sm:w-9">
              <Coins className="h-4 w-4 text-ds-success sm:h-5 sm:w-5" />
            </div>
          </div>
          <div className="mt-3 sm:mt-4 relative z-10">
            <div className="flex items-baseline gap-1">
              <span className="truncate font-mono text-xl font-black leading-none tracking-tight text-ds-text tabular-nums sm:text-[28px] lg:text-[30px]">
                {dashboardData.dailyProfit === null ? '—' : dashboardData.dailyProfit.toFixed(3)}
              </span>
              <span className="shrink-0 text-[10px] font-black text-ds-muted sm:text-xs">{currency}</span>
            </div>
            <p className="mt-1.5 flex items-center gap-1 text-[10px] font-bold text-ds-success sm:mt-2.5 sm:text-xs">
              <Clock className="w-3 h-3 shrink-0" />
              <span className="truncate">Historique</span>
            </p>
          </div>
        </div>}

        {/* CARD 3: Dépenses du Jour - ORANGE ANGLAIS */}
        <div 
          onClick={() => openHistoryModal('expenses')}
          className="stat-card before:hidden flex min-h-[140px] cursor-pointer flex-col justify-between rounded-ds-lg border border-ds-border bg-ds-surface p-3.5 text-ds-text shadow-ds-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ds-brand sm:min-h-[170px] sm:p-6"
        >
          <div className="flex items-center justify-between relative z-10 gap-1">
            <span className="truncate text-xs font-black uppercase tracking-widest text-ds-muted sm:text-sm">Dépenses</span>
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-ds-brand-soft sm:h-9 sm:w-9">
              <PackagePlus className="h-4 w-4 text-ds-brand sm:h-5 sm:w-5" />
            </div>
          </div>
          <div className="mt-3 sm:mt-4 relative z-10">
            <div className="flex items-baseline gap-1">
              <span className="truncate font-mono text-xl font-black leading-none tracking-tight text-ds-text tabular-nums sm:text-[28px] lg:text-[30px]">
                {dashboardData.dailyExpenses.toFixed(3)}
              </span>
              <span className="shrink-0 text-[10px] font-black text-ds-muted sm:text-xs">{currency}</span>
            </div>
            <p className="mt-1.5 flex items-center gap-1 text-[10px] font-bold text-ds-muted sm:mt-2.5 sm:text-xs">
              <Clock className="w-3 h-3 shrink-0" />
              <span className="truncate">Historique</span>
            </p>
          </div>
        </div>

        {/* CARD 4: Dettes - ROUGE */}
        <div 
          onClick={() => openHistoryModal('debt')}
          className="stat-card before:hidden flex min-h-[140px] cursor-pointer flex-col justify-between rounded-ds-lg border border-ds-border bg-ds-surface p-3.5 text-ds-text shadow-ds-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ds-brand sm:min-h-[170px] sm:p-6"
        >
          <div className="flex items-center justify-between relative z-10 gap-1">
            <span className="truncate text-xs font-black uppercase tracking-widest text-ds-muted sm:text-sm">Dettes</span>
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-ds-danger-soft sm:h-9 sm:w-9">
              <AlertCircle className="h-4 w-4 text-ds-danger sm:h-5 sm:w-5" />
            </div>
          </div>
          <div className="mt-3 sm:mt-4 relative z-10">
            <div className="flex items-baseline gap-1">
              <span className="truncate font-mono text-xl font-black leading-none tracking-tight text-ds-text tabular-nums sm:text-[28px] lg:text-[30px]">
                {dashboardData.dailyDebt.toFixed(3)}
              </span>
              <span className="shrink-0 text-[10px] font-black text-ds-muted sm:text-xs">{currency}</span>
            </div>
            <p className="mt-1.5 flex items-center gap-1 text-[10px] font-bold text-ds-muted sm:mt-2.5 sm:text-xs">
              <Clock className="w-3 h-3 shrink-0" />
              <span className="truncate">Historique</span>
            </p>
          </div>
        </div>

        {/* CARD 5: Nombre de ventes - VIOLET */}
        <div 
          onClick={() => openHistoryModal('sales')}
          className="stat-card before:hidden col-span-1 flex min-h-[140px] cursor-pointer flex-col justify-between rounded-ds-lg border border-ds-border bg-ds-surface p-3.5 text-ds-text shadow-ds-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ds-brand sm:col-span-2 sm:min-h-[170px] sm:p-6 xl:col-span-1"
        >
          <div className="flex items-center justify-between relative z-10 gap-1">
            <span className="truncate text-xs font-black uppercase tracking-widest text-ds-muted sm:text-sm">Ventes</span>
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-ds-brand-soft sm:h-9 sm:w-9">
              <ShoppingCart className="h-4 w-4 text-ds-brand sm:h-5 sm:w-5" />
            </div>
          </div>
          <div className="mt-3 sm:mt-4 relative z-10">
            <div className="flex items-baseline gap-1">
              <span className="truncate font-mono text-xl font-black leading-none tracking-tight text-ds-text tabular-nums sm:text-[28px] lg:text-[30px]">
                {dashboardData.todaySalesCount}
              </span>
              <span className="shrink-0 text-[10px] font-black text-ds-muted sm:text-xs">ventes</span>
            </div>
            <p className="mt-1.5 flex items-center gap-1 text-[10px] font-bold text-ds-muted sm:mt-2.5 sm:text-xs">
              <Clock className="w-3 h-3 shrink-0" />
              <span className="truncate">Historique</span>
            </p>
          </div>
        </div>
      </div>}

      {/* SECTION: VALORISATION & PERFORMANCE DU STOCK RESTANT */}
      <div className="rounded-[24px] border border-ds-border bg-ds-surface p-5 sm:p-6 xl:p-8">
        <div className="mb-5 flex flex-col justify-between gap-4 border-b border-ds-border pb-4 sm:flex-row sm:items-center">
          <div>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-ds-brand"></span>
              <h2 className="font-display text-sm font-bold uppercase tracking-wider text-ds-text">Valorisation & Performance du Stock Restant</h2>
            </div>
            <p className="mt-0.5 text-[11px] font-semibold uppercase text-ds-muted">Calculé automatiquement en temps réel à chaque modification de prix ou de stock</p>
          </div>
          {canViewSales && <button
            onClick={() => openHistoryModal('stock')}
            className="flex min-h-11 cursor-pointer items-center gap-1.5 self-start rounded-full bg-ds-brand px-5 text-xs font-black uppercase tracking-wider text-ds-brand-contrast transition-colors hover:bg-ds-brand-hover sm:self-auto"
          >
            <BarChart3 className="w-4 h-4" />
            Consulter le Rapport d'Inventaire
          </button>}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          
          {canShowMargin && <div className="flex items-center gap-4 rounded-2xl border border-ds-border bg-ds-surface-2 p-4 transition-colors hover:bg-ds-surface">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ds-brand-soft text-ds-brand">
              <Coins className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <span className="block text-[10px] font-black uppercase tracking-wider text-ds-muted">Valeur d'Achat Totale</span>
              <span className="mt-0.5 block font-display text-base font-bold tabular-nums text-ds-text">
                {stockValuation.totalBuyValue.toFixed(3)} <span className="text-xs text-ds-muted">{currency}</span>
              </span>
              <span className="mt-0.5 block text-[10px] font-bold uppercase text-ds-muted">Investi dans les marchandises</span>
            </div>
          </div>}

          {/* Card: Revenus Potentiels Estimés (Valeur de vente) */}
          {canViewSales && <div className="flex items-center gap-4 rounded-2xl border border-ds-border bg-ds-surface-2 p-4 transition-colors hover:bg-ds-surface">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ds-surface text-ds-text">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <span className="block text-[10px] font-black uppercase tracking-wider text-ds-muted">Revenus Potentiels Estimés</span>
              <span className="mt-0.5 block font-display text-base font-bold tabular-nums text-ds-text">
                {stockValuation.totalSellValue.toFixed(3)} <span className="text-xs text-ds-muted">{currency}</span>
              </span>
              <span className="mt-0.5 block text-[10px] font-bold uppercase text-ds-muted">Chiffre d'affaires estimé</span>
            </div>
          </div>}

          {canShowMargin && <div className="flex items-center gap-4 rounded-2xl border border-ds-border bg-ds-surface-2 p-4 transition-colors hover:bg-ds-surface">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ds-surface text-ds-success">
              <Sparkles className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <span className="block text-[10px] font-black uppercase tracking-wider text-ds-muted">Bénéfice Théorique (Marge)</span>
              <span className="mt-0.5 block font-display text-base font-bold tabular-nums text-ds-success">
                {stockValuation.theoreticalMargin.toFixed(3)} <span className="text-xs text-ds-muted">{currency}</span>
              </span>
              <span className="mt-0.5 block text-[10px] font-bold uppercase text-ds-muted">Marge brute théorique</span>
            </div>
          </div>}

          {canShowBuyPrice && <div className="flex items-center gap-4 rounded-2xl border border-ds-border bg-ds-surface-2 p-4 transition-colors hover:bg-ds-surface">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ds-surface text-ds-muted">
              <Percent className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <span className="block text-[10px] font-black uppercase tracking-wider text-ds-muted">Marge Commerciale Moyenne</span>
              <span className="mt-0.5 block font-display text-base font-bold tabular-nums text-ds-text">
                {stockValuation.marginRatio.toFixed(1)}%
              </span>
              <span className="mt-0.5 block text-[10px] font-bold uppercase text-ds-muted">Taux de profitabilité du stock</span>
            </div>
          </div>}

        </div>
      </div>

      {/* SECTION: VISUALISATION DU VOLUME DES VENTES SUR LES 7 DERNIERS JOURS */}
      {canViewSales && <SalesVolumeChart
        sales={sales} 
        saleCostSnapshots={saleCostSnapshots}
        currency={currency} 
        showProfit={canShowMargin}
      />}

      {/* Main layout divided into 2 Columns (Table on left, stats sidebar on right) */}
      <div className={cn('grid grid-cols-1 gap-6 border-t border-ds-border pt-8', canViewSales ? 'xl:grid-cols-3 xl:gap-8' : 'xl:grid-cols-1')}>
        
        {/* LEFT COLUMN: Dernières Ventes (Top 10) */}
        {canViewSales && <div className="xl:col-span-2 space-y-6">
          <Card className="min-w-0 overflow-hidden rounded-ds-lg p-0">
            <div className="flex items-center justify-between border-b border-ds-border bg-ds-surface-2 p-5 sm:p-6">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-ds-brand text-ds-brand-contrast">
                  <ShoppingCart className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="font-display text-sm font-bold uppercase tracking-wider text-ds-text">Dernières ventes</h2>
                  <p className="mt-0.5 text-[10px] font-semibold uppercase text-ds-muted">Transactions récentes enregistrées</p>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              {sales.slice(0, 10).length === 0 ? (
                <EmptyState
                  className="py-16"
                  icon={<ShoppingCart className="h-12 w-12" />}
                  title="Aucune vente récente dans le système"
                />
              ) : (
                <table className="responsive-card-table w-full border-collapse text-start">
                  <thead>
                    <tr className="border-b border-ds-border bg-ds-surface-2 text-[10px] font-extrabold uppercase tracking-wider text-ds-muted">
                      <th className="px-4 py-4">Vente</th>
                      {canShowMargin && <th className="px-4 py-4 text-end">Achat</th>}
                      {canShowMargin && <th className="px-4 py-4 text-end">Bénéfice</th>}
                      <th className="px-4 py-4 text-end">Total</th>
                      <th className="px-4 py-4 text-end">Montant payé</th>
                      <th className="px-4 py-4 text-end">Reste à payer</th>
                      <th className="px-4 py-4 text-center">Statut</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ds-border">
                    {sales.slice(0, 10).map((sale) => {
                      const sDate = getSaleDate(sale);
                      const formattedDate = sDate.toLocaleDateString(getDateLocale(), { day: '2-digit', month: '2-digit', year: 'numeric' });
                      const formattedTime = sDate.toLocaleTimeString(getDateLocale(), { hour: '2-digit', minute: '2-digit' });
                      const margin = canShowMargin ? computeSaleProfit(sale, saleCostSnapshots[sale.id]) : null;
                      return (
                        <tr key={sale.id} className="transition-colors hover:bg-ds-surface-2">
                          <td data-label="Vente" className="whitespace-nowrap px-4 py-4">
                            <div className="flex flex-col">
                              <span className="text-xs font-bold text-ds-text">{sale.clientName || 'Client de passage'}</span>
                              <span className="mt-0.5 font-mono text-[10px] font-semibold text-ds-muted">{formattedDate} · {formattedTime}</span>
                            </div>
                          </td>
                          {canShowMargin && (
                            <>
                              <td data-label="Achat" className="whitespace-nowrap px-4 py-4 text-end">
                                <span className="font-mono text-xs font-semibold tabular-nums text-ds-text">
                                  {margin?.complete ? `${margin.cost.toFixed(3)} ${currency}` : '—'}
                                </span>
                              </td>
                              <td data-label="Bénéfice" className="whitespace-nowrap px-4 py-4 text-end">
                                {margin?.complete && margin.profit !== null ? (
                                  <span className="inline-flex items-center gap-2">
                                    <span className={cn('font-mono text-xs font-bold tabular-nums', margin.profit < 0 ? 'text-ds-danger' : 'text-ds-success')}>
                                      {margin.profit.toFixed(3)} {currency}
                                    </span>
                                    {margin.profit < 0 && <span className="rounded-full bg-ds-danger-soft px-2.5 py-1 text-[9px] font-bold text-ds-danger">à perte</span>}
                                  </span>
                                ) : <span className="font-mono text-xs text-ds-muted">—</span>}
                              </td>
                            </>
                          )}
                          <td data-label="Total" className="whitespace-nowrap px-4 py-4 text-end">
                            <span className="font-mono text-xs font-bold tabular-nums text-ds-text">{sale.total.toFixed(3)} {currency}</span>
                          </td>
                          <td data-label="Montant payé" className="whitespace-nowrap px-4 py-4 text-end">
                            <span className="font-mono text-xs font-semibold tabular-nums text-ds-text">{sale.paid.toFixed(3)} {currency}</span>
                          </td>
                          <td data-label="Reste à payer" className="whitespace-nowrap px-4 py-4 text-end">
                            {sale.debt > 0 ? (
                              <span className="font-mono text-xs font-bold tabular-nums text-ds-danger">-{sale.debt.toFixed(3)} {currency}</span>
                            ) : (
                              <span className="font-mono text-xs font-semibold tabular-nums text-ds-muted">0.000 {currency}</span>
                            )}
                          </td>
                          <td data-label="Statut" className="whitespace-nowrap px-4 py-4 text-center">
                            <Badge variant={sale.debt > 0 ? 'warning' : 'success'} className="min-h-7 px-2.5 py-1 text-[9px] uppercase tracking-wider">
                              {sale.debt > 0 ? 'Crédit' : 'Réglé'}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </Card>
        </div>}

        {/* RIGHT COLUMN: Products Bestsellers and Low Stock alerts */}
        <div className="space-y-6">
          
          {/* Section: Top Products TODAY */}
          {canViewSales && <div className="overflow-hidden rounded-[24px] border border-ds-border bg-ds-surface">
            <div className="flex items-center justify-between border-b border-ds-border bg-ds-surface-2 p-5">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-ds-brand text-ds-brand-contrast">
                  <Package className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="font-display text-xs font-bold uppercase tracking-wider text-ds-text">Top Ventes Aujourd'hui</h2>
                  <p className="mt-0.5 text-[10px] font-semibold uppercase text-ds-muted">Par volume d'articles vendus</p>
                </div>
              </div>
            </div>

            <div className="divide-y divide-ds-border p-5">
              {dashboardData.topProductsToday.length === 0 ? (
                <EmptyState
                  className="py-10"
                  icon={<Package className="h-10 w-10" />}
                  title="Aucune vente aujourd'hui"
                />
              ) : (
                dashboardData.topProductsToday.map((p, idx) => (
                  <div key={idx} className="flex items-center gap-3 py-3 transition-colors first:pt-1 last:pb-1 hover:bg-ds-surface-2">
                    <div className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ds-surface-2 text-xs font-extrabold text-ds-text"
                    )}>
                      #{idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="truncate text-xs font-bold text-ds-text">{p.name}</h4>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="font-mono text-[10px] font-bold text-ds-muted">{p.count} unités</span>
                        <span className="text-[10px] text-ds-muted">|</span>
                        <span className="text-[10px] font-black text-ds-text">CA: {p.total.toFixed(3)} {currency}</span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>}

          {/* Section: Low Stock Warning */}
          <div className="overflow-hidden rounded-[24px] border border-ds-border bg-ds-surface">
            <div className="flex items-center justify-between border-b border-ds-border bg-ds-surface-2 p-5">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-ds-danger-soft text-ds-danger">
                  <AlertTriangle className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="font-display text-xs font-bold uppercase tracking-wider text-ds-text">Alerte Stock Faible</h2>
                  <p className="mt-0.5 text-[10px] font-semibold uppercase text-ds-muted">
                    Seuil configuré : {dashboardData.configuredMinStock} unités
                  </p>
                </div>
              </div>
              <span className={cn(
                "rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider",
                dashboardData.lowStockAlerts.length > 0 ? "bg-ds-danger-soft text-ds-danger" : "bg-ds-surface-2 text-ds-muted"
              )}>
                {dashboardData.lowStockAlerts.length} produits
              </span>
            </div>

            <div className="max-h-[350px] divide-y divide-ds-border overflow-y-auto p-5">
              {dashboardData.lowStockAlerts.length === 0 ? (
                <EmptyState className="py-10" icon={<Package className="h-10 w-10" />} title="État des stocks satisfaisant" />
              ) : (
                dashboardData.lowStockAlerts.map((product) => {
                  const effectiveThreshold = product.lowStockAlert !== undefined && product.lowStockAlert >= 0 
                    ? product.lowStockAlert 
                    : dashboardData.configuredMinStock;
                  return (
                    <div 
                      key={product.id} 
                      onClick={() => openHistoryModal('stock')}
                      className="group -mx-2 flex cursor-pointer items-center justify-between rounded-xl px-2 py-3 transition-colors first:pt-1 last:pb-1 hover:bg-ds-surface-2"
                    >
                      <div className="min-w-0 flex-1 pe-2">
                        <h4 className="truncate text-xs font-bold text-ds-text transition-colors" title={product.name}>
                          {product.name}
                        </h4>
                        <p className="mt-0.5 text-[10px] font-semibold text-ds-muted">
                          Seuil minimal : {effectiveThreshold} unités
                        </p>
                      </div>
                      <div className="text-end shrink-0">
                        <Badge variant={product.stock <= 0 ? 'danger' : 'warning'} className="min-h-7 rounded-ds-sm px-2 py-1 font-mono text-xs font-black">
                          {product.stock <= 0 ? 'Rupture (0)' : `${product.stock} dispo`}
                        </Badge>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

        </div>
      </div>

      {/* MODAL: INTERACTIVE DAILY HISTORY CONSULTATION */}
      {activeModal && (
        <div 
          onClick={() => setActiveModal(null)}
          className="fixed inset-0 z-50 overflow-y-auto bg-ds-text/60 backdrop-blur-xs flex items-center justify-center p-4 cursor-pointer"
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            className="bg-ds-surface rounded-3xl w-full max-w-5xl shadow-2xl border border-ds-border overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200 cursor-default"
          >
            
            {/* Modal Header */}
            <div className={cn(
              "p-6 text-ds-brand-contrast flex items-center justify-between relative overflow-hidden shrink-0",
              activeModal === 'revenue' ? "bg-ds-accent" :
              activeModal === 'profit' ? "bg-ds-success" :
              activeModal === 'debt' ? "bg-ds-danger" :
              activeModal === 'stock' ? "bg-ds-brand" :
              "bg-ds-brand"
            )}>
              <div className="absolute inset-0   "></div>
              <div className="relative z-10 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-ds-surface/10 flex items-center justify-center backdrop-blur-xs">
                  {activeModal === 'revenue' && <TrendingUp className="w-5 h-5 text-ds-accent" />}
                  {activeModal === 'profit' && <Coins className="w-5 h-5 text-ds-success" />}
                  {activeModal === 'debt' && <AlertCircle className="w-5 h-5 text-ds-danger" />}
                  {activeModal === 'sales' && <ShoppingCart className="w-5 h-5 text-ds-brand" />}
                  {activeModal === 'stock' && <Package className="w-5 h-5 text-ds-brand" />}
                </div>
                <div>
                  <h3 className="text-lg font-black tracking-tight leading-none">
                    {activeModal === 'revenue' && "Consulter l'Historique : Chiffre d'Affaires"}
                    {activeModal === 'profit' && "Consulter l'Historique : Bénéfice Net"}
                    {activeModal === 'debt' && "Consulter l'Historique : Dettes"}
                    {activeModal === 'sales' && "Consulter l'Historique : Nombre de ventes"}
                    {activeModal === 'stock' && "Rapport de Valorisation & Rentabilité du Stock"}
                  </h3>
                  <p className="text-[10px] uppercase font-bold tracking-wider text-ds-brand-contrast/70 mt-1">
                    {activeModal === 'revenue' && "Suivi de la courbe des ventes brutes"}
                    {activeModal === 'profit' && "Rendement financier après déduction du coût d'achat"}
                    {activeModal === 'debt' && "Encours clients et d'impayés du jour"}
                    {activeModal === 'sales' && "Intensité de l'activité du magasin"}
                    {activeModal === 'stock' && (canShowMargin
                      ? "Analyse en temps réel de la valeur d'achat, de vente et des marges bénéficiaires de l'inventaire actuel"
                      : "Analyse en temps réel du stock disponible et des revenus potentiels")}
                  </p>
                </div>
              </div>

              <button 
                onClick={() => setActiveModal(null)} 
                className="relative z-10 px-4 py-2 flex items-center gap-2 bg-ds-surface/15 hover:bg-ds-surface/25 rounded-xl transition-all cursor-pointer text-ds-brand-contrast text-xs font-black uppercase tracking-wider"
              >
                <X className="w-4 h-4" />
                <span>Fermer</span>
              </button>
            </div>

            {/* Modal Controls / Filters */}
            <div className="p-6 bg-ds-surface-2/50 border-b border-ds-border flex flex-col gap-4 shrink-0 font-sans">
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                
                {/* Search bar */}
                <div className="md:col-span-4 relative">
                  <Search className="absolute start-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ds-muted" />
                  <input 
                    type="text"
                    value={searchQuery}
                    onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                    placeholder={activeModal === 'stock' ? "Rechercher un produit, code barre..." : "Rechercher une date (ex: 22/06)..."}
                    className="w-full ps-10 pe-4 py-2 bg-ds-surface border border-ds-border rounded-xl text-base font-semibold placeholder:text-ds-muted outline-none focus:ring-2 focus:ring-ds-brand/10 focus:border-ds-brand transition-all sm:text-xs"
                  />
                </div>

                {/* Period Selection or Stock KPIs */}
                {activeModal === 'stock' ? (
                  <div className="md:col-span-8 flex flex-wrap items-center gap-4 md:justify-end">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-ds-surface px-4 py-2.5 rounded-2xl border border-ds-border shadow-xs text-[11px] font-bold text-ds-muted">
                      <div>
                        <span>Articles : </span>
                        <span className="text-ds-text font-black font-mono">{stockValuation.totalItemsCount}</span>
                      </div>
                      <div className="hidden sm:block w-px h-3.5 bg-ds-surface-2"></div>
                      <div>
                        <span>Stock Total : </span>
                        <span className="text-ds-text font-black font-mono">{stockValuation.totalStockQty}</span>
                      </div>
                      <div className="hidden sm:block w-px h-3.5 bg-ds-surface-2"></div>
                      {canShowBuyPrice && <div>
                        <span>Valeur d'Achat : </span>
                        <span className="text-ds-text font-black font-mono">{stockValuation.totalBuyValue.toFixed(3)} {currency}</span>
                      </div>}
                      {canShowBuyPrice && <div className="hidden sm:block w-px h-3.5 bg-ds-surface-2"></div>}
                      <div>
                        <span>Revenus Est. : </span>
                        <span className="text-ds-brand font-black font-mono">{stockValuation.totalSellValue.toFixed(3)} {currency}</span>
                      </div>
                      {canShowMargin && <div className="hidden sm:block w-px h-3.5 bg-ds-surface-2"></div>}
                      {canShowMargin && <div>
                        <span>Marge Est. : </span>
                        <span className="text-ds-brand font-black font-mono">{stockValuation.theoreticalMargin.toFixed(3)} {currency} ({stockValuation.marginRatio.toFixed(1)}%)</span>
                      </div>}
                    </div>
                  </div>
                ) : (
                  <div className="md:col-span-8 flex flex-wrap items-center gap-2 md:justify-end">
                    <span className="text-[10px] font-black uppercase text-ds-muted tracking-wider me-1">Filtre Période :</span>
                    {(['today', '7', '30', '90', 'year', 'all', 'custom'] as const).map(p => {
                      const label = p === 'today' ? "Aujourd'hui" :
                                    p === '7' ? '7 jours' :
                                    p === '30' ? '30 jours' :
                                    p === '90' ? '90 jours' :
                                    p === 'year' ? 'Cette année' :
                                    p === 'all' ? 'Tout' : 'Personnalisée';
                      return (
                        <button
                          key={p}
                          onClick={() => { setPeriodFilter(p); setCurrentPage(1); }}
                          className={cn(
                            "px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer",
                            periodFilter === p
                              ? "bg-ds-brand text-ds-brand-contrast shadow-md shadow-ds-sm"
                              : "bg-ds-surface text-ds-muted border border-ds-border hover:bg-ds-surface-2"
                          )}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Custom date range option */}
              {activeModal !== 'stock' && periodFilter === 'custom' && (
                <div className="flex items-center gap-3 p-3 bg-ds-surface rounded-2xl border border-ds-border shadow-xs max-w-lg animate-in slide-in-from-top-2 duration-200">
                  <div className="relative flex-1">
                    <Calendar className="absolute start-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ds-muted pointer-events-none" />
                    <input 
                      type="date"
                      value={startDate}
                      onChange={(e) => { setStartDate(e.target.value); setCurrentPage(1); }}
                      className="w-full ps-9 pe-3 py-1.5 border border-ds-border rounded-xl text-base font-medium outline-none sm:text-xs"
                    />
                  </div>
                  <span className="text-ds-muted font-bold text-xs">à</span>
                  <div className="relative flex-1">
                    <Calendar className="absolute start-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ds-muted pointer-events-none" />
                    <input 
                      type="date"
                      value={endDate}
                      onChange={(e) => { setEndDate(e.target.value); setCurrentPage(1); }}
                      className="w-full ps-9 pe-3 py-1.5 border border-ds-border rounded-xl text-base font-medium outline-none sm:text-xs"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Synthèse instantanée du stock (Rapport de Valorisation) */}
            {activeModal === 'stock' && (
              <div className="px-6 pt-5 shrink-0 font-sans">
                <div className="bg-ds-brand rounded-2xl p-5 text-ds-brand-contrast shadow-lg shadow-ds-sm relative overflow-hidden">
                  <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-ds-surface/10 flex items-center justify-center backdrop-blur-xs shrink-0">
                        <Package className="w-5 h-5 text-ds-brand" />
                      </div>
                      <div>
                        <span className="text-[10px] font-black uppercase tracking-widest text-ds-brand/80 block">Produits existants en stock</span>
                        <div className="flex items-baseline gap-1.5 mt-0.5">
                          <span className="text-2xl font-black font-mono leading-none">{stockValuation.inStockItemsCount}</span>
                          <span className="text-[11px] font-bold text-ds-brand/80">/ {stockValuation.totalItemsCount} références</span>
                        </div>
                        {stockValuation.outOfStockCount > 0 && (
                          <span className="text-[9px] font-bold uppercase text-ds-danger block mt-0.5">{stockValuation.outOfStockCount} produit(s) en rupture</span>
                        )}
                      </div>
                    </div>
                    <div className="hidden md:block w-px h-12 bg-ds-surface/15"></div>
                    <div>
                      <span className="text-[10px] font-black uppercase tracking-widest text-ds-brand/80 block">Valeur de mon stock à cet instant</span>
                      <div className="flex items-baseline gap-1.5 mt-0.5">
                        <span className="text-2xl font-black font-mono leading-none">{stockValuation.totalBuyValue.toFixed(3)}</span>
                        <span className="text-[11px] font-bold text-ds-brand/80">{currency} (valeur d'achat)</span>
                      </div>
                      <span className="text-[9px] font-bold uppercase text-ds-brand/70 block mt-0.5">Soit {stockValuation.totalSellValue.toFixed(3)} {currency} en valeur de vente potentielle</span>
                    </div>
                    <div className="hidden md:block w-px h-12 bg-ds-surface/15"></div>
                    <div className="text-end md:text-start">
                      <span className="text-[10px] font-black uppercase tracking-widest text-ds-brand/80 block">Calculé le</span>
                      <span className="text-xs font-black font-mono block mt-1">{new Date().toLocaleDateString(getDateLocale())} à {new Date().toLocaleTimeString(getDateLocale(), { hour: '2-digit', minute: '2-digit' })}</span>
                      <span className="text-[9px] font-bold uppercase text-ds-brand/70 block mt-0.5">Temps réel · inventaire actuel</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Modal Table Area (Scrollable body) */}
            <div className="min-w-0 flex-1 overflow-x-auto overflow-y-auto font-sans">
              {((activeModal === 'stock' ? filteredAndSortedProducts.length : filteredAndSortedRecords.length) === 0) ? (
                <EmptyState
                  className="py-24"
                  icon={<Calendar className="h-12 w-12" />}
                  title="Aucune donnée trouvée"
                  description="Ajustez la recherche pour visualiser d'autres articles ou données."
                />
              ) : (
                <div className="overflow-x-auto p-3 sm:p-6">
                  <table className="w-full border-collapse text-start text-xs">
                    <thead>
                      <tr className="border-b border-ds-border text-[10px] font-black uppercase tracking-wider text-ds-muted bg-ds-surface-2/70">
                        {activeModal === 'stock' ? (
                          <>
                            <th 
                              onClick={() => { setSortField('date'); setSortAsc(!sortAsc); }}
                              className="px-6 py-3 cursor-pointer hover:bg-ds-surface-2 transition-colors select-none"
                            >
                              <div className="flex items-center gap-1.5">
                                Désignation du Produit
                                <ArrowUpDown className="w-3.5 h-3.5 text-ds-muted" />
                              </div>
                            </th>
                            <th className="px-6 py-3 text-center">Quantité en Stock</th>
                            {canShowBuyPrice && <th className="px-6 py-3 text-end">Prix d'Achat Unit.</th>}
                            <th className="px-6 py-3 text-end">Prix de Vente Unit.</th>
                            {canShowBuyPrice && <th className="px-6 py-3 text-end">Valeur d'Achat Totale</th>}
                            <th className="px-6 py-3 text-end">Valeur de Vente Totale (Revenus Est.)</th>
                            {canShowMargin && <th
                              onClick={() => { setSortField('value'); setSortAsc(!sortAsc); }}
                              className="px-6 py-3 cursor-pointer hover:bg-ds-surface-2 transition-colors text-end select-none"
                            >
                              <div className="flex items-center gap-1.5 justify-end">
                                Marge Bénéficiaire Théorique
                                <ArrowUpDown className="w-3.5 h-3.5 text-ds-muted" />
                              </div>
                            </th>}
                          </>
                        ) : (
                          <th 
                            onClick={() => { setSortField('date'); setSortAsc(!sortAsc); }}
                            className="px-6 py-3 cursor-pointer hover:bg-ds-surface-2 transition-colors select-none"
                          >
                            <div className="flex items-center gap-1.5">
                              Date de l'activité
                              <ArrowUpDown className="w-3.5 h-3.5 text-ds-muted" />
                            </div>
                          </th>
                        )}
                        
                        {activeModal === 'revenue' && (
                          <>
                            <th className="px-6 py-3 text-center">Nbre Ventes</th>
                            <th className="px-6 py-3 text-end">Montant Encaissé (Liquide)</th>
                            <th className="px-6 py-3 text-end">Dettes Créées</th>
                            <th 
                              onClick={() => { setSortField('value'); setSortAsc(!sortAsc); }}
                              className="px-6 py-3 cursor-pointer hover:bg-ds-surface-2 transition-colors text-end select-none"
                            >
                              <div className="flex items-center gap-1.5 justify-end">
                                Chiffre d'Affaires Brut
                                <ArrowUpDown className="w-3.5 h-3.5 text-ds-muted" />
                              </div>
                            </th>
                          </>
                        )}

                        {activeModal === 'profit' && (
                          <>
                            <th className="px-6 py-3 text-end">Chiffre d'Affaires</th>
                            <th className="px-6 py-3 text-end">Coût estimé des articles</th>
                            <th className="px-6 py-3 text-end">Ratio Marge (%)</th>
                            <th 
                              onClick={() => { setSortField('value'); setSortAsc(!sortAsc); }}
                              className="px-6 py-3 cursor-pointer hover:bg-ds-surface-2 transition-colors text-end select-none"
                            >
                              <div className="flex items-center gap-1.5 justify-end">
                                Bénéfice Net
                                <ArrowUpDown className="w-3.5 h-3.5 text-ds-muted" />
                              </div>
                            </th>
                          </>
                        )}

                        {activeModal === 'debt' && (
                          <>
                            <th className="px-6 py-3 text-end">Total CA du Jour</th>
                            <th className="px-6 py-3 text-end">Total Crédit Accordé</th>
                            <th className="px-6 py-3 text-center">Nbre Tickets à Crédit</th>
                            <th 
                              onClick={() => { setSortField('value'); setSortAsc(!sortAsc); }}
                              className="px-6 py-3 cursor-pointer hover:bg-ds-surface-2 transition-colors text-end select-none"
                            >
                              <div className="flex items-center gap-1.5 justify-end">
                                Somme des Impayés
                                <ArrowUpDown className="w-3.5 h-3.5 text-ds-muted" />
                              </div>
                            </th>
                          </>
                        )}

                        {activeModal === 'sales' && (
                          <>
                            <th className="px-6 py-3 text-center font-bold text-ds-muted">Panier Moyen journalier</th>
                            <th className="px-6 py-3 text-end">Ventes encaissées</th>
                            <th 
                              onClick={() => { setSortField('value'); setSortAsc(!sortAsc); }}
                              className="px-6 py-3 cursor-pointer hover:bg-ds-surface-2 transition-colors text-center select-none bg-ds-brand-soft/30"
                            >
                              <div className="flex items-center gap-1.5 justify-center">
                                Nombre de Ventes
                                <ArrowUpDown className="w-3.5 h-3.5 text-ds-muted" />
                              </div>
                            </th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ds-border">
                      {paginatedRecords.map((rec, rIdx) => {
                        if (activeModal === 'stock') {
                          const product = rec as Product;
                          const stock = product.stock || 0;
                          const buyVal = canViewBuyPrice ? stock * (product.buyPrice || 0) : 0;
                          const sellVal = stock * (product.sellPrice || 0);
                          const profitVal = canViewMargin ? sellVal - buyVal : 0;
                          return (
                            <tr key={product.id || rIdx} className="hover:bg-ds-surface-2/50 transition-colors">
                              <td className="px-6 py-3.5 whitespace-nowrap">
                                <div className="flex flex-col">
                                  <span className="text-xs font-bold text-ds-text">{product.name}</span>
                                  <span className="text-[10px] text-ds-muted font-mono">{product.barcode || 'Sans codebarre'}</span>
                                </div>
                              </td>
                              <td className="px-6 py-3.5 text-center whitespace-nowrap">
                                <span className={cn(
                                  "px-2.5 py-1 rounded-xl text-xs font-black font-mono inline-block border",
                                  stock === 0 ? "bg-ds-danger-soft text-ds-danger border-ds-danger" :
                                  stock <= (product.lowStockAlert || 5) ? "bg-ds-danger-soft text-ds-danger border-ds-danger" :
                                  "bg-ds-success-soft text-ds-success border-ds-success"
                                )}>
                                  {stock} unités
                                </span>
                              </td>
                              {canShowBuyPrice && <td className="px-6 py-3.5 text-end font-semibold text-ds-muted font-mono">
                                {(product.buyPrice || 0).toFixed(3)} {currency}
                              </td>}
                              <td className="px-6 py-3.5 text-end font-bold text-ds-text font-mono">
                                {(product.sellPrice || 0).toFixed(3)} {currency}
                              </td>
                              {canShowBuyPrice && <td className="px-6 py-3.5 text-end text-ds-muted font-mono">
                                {buyVal.toFixed(3)} {currency}
                              </td>}
                              <td className="px-6 py-3.5 text-end font-black text-ds-text font-mono">
                                {sellVal.toFixed(3)} {currency}
                              </td>
                              {canShowMargin && <td className="px-6 py-3.5 text-end whitespace-nowrap">
                                <span className="px-3 py-1 bg-ds-brand-soft text-ds-brand font-black font-mono rounded-lg border border-ds-border text-xs">
                                  {profitVal.toFixed(3)} {currency}
                                </span>
                              </td>}
                            </tr>
                          );
                        }

                        const dayRec = rec as any;
                        const formattedDate = dayRec.dateObj.toLocaleDateString(getDateLocale(), { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
                        return (
                          <tr key={dayRec.dateStr} className="hover:bg-ds-surface-2/50 transition-colors">
                            <td className="px-6 py-3.5 whitespace-nowrap">
                              <div className="flex flex-col">
                                <span className="text-xs font-bold text-ds-text capitalize">{formattedDate}</span>
                                <span className="text-[10px] text-ds-muted font-mono font-bold">{dayRec.dateStr}</span>
                              </div>
                            </td>

                            {activeModal === 'revenue' && (
                              <>
                                <td className="px-6 py-3.5 text-center font-bold text-ds-text font-mono">{dayRec.salesCount}</td>
                                <td className="px-6 py-3.5 text-end font-bold text-ds-success font-mono">{dayRec.cashAmount.toFixed(3)} {currency}</td>
                                <td className="px-6 py-3.5 text-end font-semibold text-ds-danger font-mono">{dayRec.debt.toFixed(3)} {currency}</td>
                                <td className="px-6 py-3.5 text-end whitespace-nowrap">
                                  <span className="px-3 py-1 bg-ds-accent-soft text-ds-accent font-black font-mono rounded-lg border border-ds-border text-xs">
                                    {dayRec.revenue.toFixed(3)} {currency}
                                  </span>
                                </td>
                              </>
                            )}

                            {activeModal === 'profit' && (
                              <>
                                <td className="px-6 py-3.5 text-end font-semibold text-ds-muted font-mono">{dayRec.revenue.toFixed(3)} {currency}</td>
                                <td className="px-6 py-3.5 text-end text-ds-muted font-mono">{(dayRec.revenue - dayRec.profit).toFixed(3)} {currency}</td>
                                <td className="px-6 py-3.5 text-end whitespace-nowrap">
                                  <span className="text-[10px] font-black text-ds-success bg-ds-success-soft px-2 py-0.5 rounded-md border border-ds-success">
                                    {dayRec.revenue > 0 ? ((dayRec.profit / dayRec.revenue) * 100).toFixed(1) + '%' : '0.0%'}
                                  </span>
                                </td>
                                <td className="px-6 py-3.5 text-end whitespace-nowrap">
                                  <span className="px-3 py-1 bg-ds-success-soft text-ds-success font-black font-mono rounded-lg border border-ds-success text-xs">
                                    {dayRec.profit.toFixed(3)} {currency}
                                  </span>
                                </td>
                              </>
                            )}

                            {activeModal === 'debt' && (
                              <>
                                <td className="px-6 py-3.5 text-end text-ds-muted font-mono">{dayRec.revenue.toFixed(3)} {currency}</td>
                                <td className="px-6 py-3.5 text-end text-ds-muted font-mono">{dayRec.cashAmount.toFixed(3)} {currency}</td>
                                <td className="px-6 py-3.5 text-center font-bold text-ds-text font-mono">{dayRec.salesCount}</td>
                                <td className="px-6 py-3.5 text-end whitespace-nowrap">
                                  <span className="px-3 py-1 bg-ds-danger-soft text-ds-danger font-black font-mono rounded-lg border border-ds-danger text-xs">
                                    {dayRec.debt.toFixed(3)} {currency}
                                  </span>
                                </td>
                              </>
                            )}

                            {activeModal === 'sales' && (
                              <>
                                <td className="px-6 py-3.5 text-center font-semibold text-ds-muted font-mono">
                                  {dayRec.salesCount > 0 ? (dayRec.revenue / dayRec.salesCount).toFixed(3) : '0.000'} {currency}
                                </td>
                                <td className="px-6 py-3.5 text-end text-ds-muted font-mono">{dayRec.salesCount}</td>
                                <td className="px-6 py-3.5 text-center whitespace-nowrap bg-ds-brand-soft/10">
                                  <span className="px-3 py-1 bg-ds-brand-soft text-ds-brand font-black font-mono rounded-lg border border-ds-border text-xs">
                                    {dayRec.salesCount} transactions
                                  </span>
                                </td>
                              </>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Modal Footer / Actions */}
            <div className="p-6 bg-ds-surface-2/50 border-t border-ds-border flex flex-col sm:flex-row items-center justify-between gap-4 shrink-0 font-sans">
              
              {/* Pagination controls */}
              {totalPages > 1 ? (
                <div className="flex items-center gap-2">
                  <button
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    className="p-1.5 bg-ds-surface border border-ds-border rounded-lg text-ds-muted disabled:opacity-40 hover:bg-ds-surface-2 cursor-pointer transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-xs font-bold text-ds-muted">
                    Page {currentPage} sur {totalPages}
                  </span>
                  <button
                    disabled={currentPage === totalPages}
                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                    className="p-1.5 bg-ds-surface border border-ds-border rounded-lg text-ds-muted disabled:opacity-40 hover:bg-ds-surface-2 cursor-pointer transition-colors"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="text-xs font-bold text-ds-muted block uppercase">
                  {activeModal === 'stock'
                    ? `Total : ${filteredAndSortedProducts.length} articles répertoriés`
                    : `Total : ${filteredAndSortedRecords.length} rapports de journée`}
                </div>
              )}

              {/* Action button row */}
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="flex items-center gap-2 px-4 py-2.5 bg-ds-surface-2 hover:bg-ds-surface-2 text-ds-text rounded-xl text-xs font-black uppercase tracking-wider cursor-pointer transition-all active:scale-[0.98] border border-ds-border shadow-xs"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Retour au Tableau de bord
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setTimeout(() => {
                      window.print();
                    }, 100);
                  }}
                  className="flex items-center gap-2 px-4 py-2.5 bg-ds-brand hover:bg-ds-brand text-ds-brand-contrast rounded-xl text-xs font-black uppercase tracking-wider cursor-pointer transition-all active:scale-[0.98] shadow-md shadow-ds-sm"
                >
                  <Printer className="w-4 h-4" />
                  Imprimer le rapport
                </button>
                
                <button
                  type="button"
                  onClick={handleExportHistory}
                  className="flex items-center gap-2 px-4 py-2.5 bg-ds-success hover:bg-ds-success text-ds-brand-contrast rounded-xl text-xs font-black uppercase tracking-wider cursor-pointer transition-all active:scale-[0.98] shadow-md shadow-ds-sm"
                >
                  <Download className="w-4 h-4" />
                  Exporter Excel
                </button>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* MODAL: INTERACTIVE EXPENSES DETAIL & HISTORY */}
      {activeModal === 'expenses' && (
        <div 
          onClick={() => setActiveModal(null)}
          className="fixed inset-0 z-50 overflow-y-auto bg-ds-text/60 backdrop-blur-xs flex items-center justify-center p-4 cursor-pointer"
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            className="bg-ds-surface rounded-3xl w-full max-w-5xl shadow-2xl border border-ds-border overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200 cursor-default"
          >
            {/* Modal Header */}
            <div className="p-6 text-ds-brand-contrast bg-ds-brand flex items-center justify-between relative overflow-hidden shrink-0">
              <div className="absolute inset-0   "></div>
              <div className="relative z-10 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-ds-surface/10 flex items-center justify-center backdrop-blur-xs">
                  <PackagePlus className="w-5 h-5 text-ds-brand-contrast" />
                </div>
                <div>
                  <h3 className="text-lg font-black tracking-tight leading-none">
                    Consulter l'Historique : Dépenses de Stock
                  </h3>
                  <p className="text-[10px] uppercase font-bold tracking-wider text-ds-brand-contrast/70 mt-1">
                    Suivi automatique du coût d'acquisition des marchandises
                  </p>
                </div>
              </div>

              <button 
                onClick={() => setActiveModal(null)} 
                className="relative z-10 px-4 py-2 flex items-center gap-2 bg-ds-surface/15 hover:bg-ds-surface/25 rounded-xl transition-all cursor-pointer text-ds-brand-contrast text-xs font-black uppercase tracking-wider"
              >
                <X className="w-4 h-4" />
                <span>Fermer</span>
              </button>
            </div>

            {/* Modal Controls / Tabs & Filters */}
            <div className="p-6 bg-ds-surface-2/50 border-b border-ds-border flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0 font-sans">
              <div className="flex gap-2">
                <button
                  onClick={() => { setExpensesTab('daily'); setExpensesPage(1); }}
                  className={cn(
                    "px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer",
                    expensesTab === 'daily'
                      ? "bg-ds-brand text-ds-brand-contrast shadow-md shadow-ds-sm"
                      : "bg-ds-surface text-ds-muted border border-ds-border hover:bg-ds-surface-2"
                  )}
                >
                  Historique Journalier
                </button>
                <button
                  onClick={() => { setExpensesTab('detailed'); setExpensesPage(1); }}
                  className={cn(
                    "px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer",
                    expensesTab === 'detailed'
                      ? "bg-ds-brand text-ds-brand-contrast shadow-md shadow-ds-sm"
                      : "bg-ds-surface text-ds-muted border border-ds-border hover:bg-ds-surface-2"
                  )}
                >
                  Détails des Opérations
                </button>
              </div>

              {/* Search input dynamically scoped to active tab search */}
              <div className="relative w-full sm:w-72">
                <Search className="absolute start-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ds-muted" />
                <input 
                  type="text"
                  value={expensesSearch}
                  onChange={(e) => { setExpensesSearch(e.target.value); setExpensesPage(1); }}
                  placeholder={expensesTab === 'daily' ? "Rechercher une date (ex: 22/06)..." : "Rechercher un produit ou date..."}
                  className="w-full ps-10 pe-4 py-2 bg-ds-surface border border-ds-border rounded-xl text-base font-semibold placeholder:text-ds-muted outline-none focus:ring-2 focus:ring-ds-brand/10 focus:border-ds-brand transition-all sm:text-xs"
                />
              </div>
            </div>

            {/* Modal Table Content */}
            <div className="min-w-0 grow overflow-x-auto overflow-y-auto font-sans p-3 sm:p-6">
              {expensesTab === 'daily' ? (
                // Tab 1: Daily grouping list
                dailySuppliesRecords.length === 0 ? (
                  <EmptyState
                    className="py-12"
                    icon={<AlertCircle className="h-5 w-5" />}
                    title="Aucun approvisionnement"
                    description="Ajoutez du stock aux articles pour suivre vos dépenses."
                  />
                ) : (
                  <table className="w-full border-collapse text-start text-xs">
                    <thead>
                      <tr className="border-b border-ds-border text-[10px] font-black uppercase tracking-wider text-ds-muted bg-ds-surface-2/70">
                        <th className="px-6 py-3">Date</th>
                        <th className="px-6 py-3 text-center">Nbre de Produits Ajoutés</th>
                        <th className="px-6 py-3 text-center">Quantité Totale Ajoutée</th>
                        <th className="px-6 py-3 text-end">Dépenses Totales</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ds-border">
                      {dailySuppliesRecords.map((rec) => {
                        const formattedDate = rec.dateObj.toLocaleDateString(getDateLocale(), { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
                        return (
                          <tr key={rec.dateStr} className="hover:bg-ds-surface-2/50 transition-colors">
                            <td className="px-6 py-3.5 whitespace-nowrap font-bold text-ds-text capitalize">
                              {formattedDate}
                            </td>
                            <td className="px-6 py-3.5 text-center font-bold text-ds-muted font-mono">
                              {rec.productsCount}
                            </td>
                            <td className="px-6 py-3.5 text-center font-bold text-ds-muted font-mono">
                              {rec.totalQty}
                            </td>
                            <td className="px-6 py-3.5 text-end whitespace-nowrap">
                              <span className="px-3 py-1 bg-ds-brand-soft text-ds-brand font-black font-mono rounded-lg border border-ds-brand text-xs">
                                {rec.totalExpenses.toFixed(3)} {currency}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )
              ) : (
                // Tab 2: Detailed Raw entries
                filteredSupplies.length === 0 ? (
                  <EmptyState
                    className="py-12"
                    icon={<AlertCircle className="h-5 w-5" />}
                    title="Aucune opération trouvée"
                    description="Ajustez les termes de votre recherche."
                  />
                ) : (
                  <table className="w-full border-collapse text-start text-xs">
                    <thead>
                      <tr className="border-b border-ds-border text-[10px] font-black uppercase tracking-wider text-ds-muted bg-ds-surface-2/70">
                        <th className="px-6 py-3">Date et Heure</th>
                        <th className="px-6 py-3">Produit</th>
                        <th className="px-6 py-3 text-center">Quantité Ajoutée</th>
                        <th className="px-6 py-3 text-end">Prix d'Achat unitaire</th>
                        <th className="px-6 py-3 text-end">Coût Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ds-border">
                      {paginatedSupplies.map((sup: any) => {
                        const dateObj = !sup.date ? new Date() : (typeof sup.date.toDate === 'function' ? sup.date.toDate() : new Date(sup.date));
                        const formattedDateTime = dateObj.toLocaleString(getDateLocale(), {
                          day: '2-digit', 
                          month: 'short', 
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        });
                        return (
                          <tr key={sup.id} className="hover:bg-ds-surface-2/50 transition-colors">
                            <td className="px-6 py-3.5 whitespace-nowrap text-ds-muted font-bold font-mono">
                              {formattedDateTime}
                            </td>
                            <td className="px-6 py-3.5 font-bold text-ds-text">
                              {sup.productName || 'Produit supprimé'}
                            </td>
                            <td className="px-6 py-3.5 text-center font-extrabold text-ds-text font-mono">
                              {sup.quantity || 0}
                            </td>
                            <td className="px-6 py-3.5 text-end font-semibold text-ds-muted font-mono">
                              {(sup.buyPrice || 0).toFixed(3)} {currency}
                            </td>
                            <td className="px-6 py-3.5 text-end font-black text-ds-brand font-mono">
                              {(sup.totalCost || 0).toFixed(3)} {currency}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )
              )}
            </div>

            {/* Modal Footer / Navigation */}
            <div className="p-6 bg-ds-surface-2/50 border-t border-ds-border flex flex-col md:flex-row items-center justify-between gap-4 shrink-0 font-sans">
              
              {/* Pagination indicators specifically for Tab 2 */}
              {expensesTab === 'detailed' && totalExpensesPages > 1 ? (
                <div className="flex items-center gap-2">
                  <button
                    disabled={expensesPage === 1}
                    onClick={() => setExpensesPage(prev => Math.max(1, prev - 1))}
                    className="p-1.5 bg-ds-surface border border-ds-border rounded-lg text-ds-muted disabled:opacity-40 hover:bg-ds-surface-2 cursor-pointer transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-[11px] font-bold text-ds-muted">
                    Page {expensesPage} sur {totalExpensesPages}
                  </span>
                  <button
                    disabled={expensesPage === totalExpensesPages}
                    onClick={() => setExpensesPage(prev => Math.min(totalExpensesPages, prev + 1))}
                    className="p-1.5 bg-ds-surface border border-ds-border rounded-lg text-ds-muted disabled:opacity-40 hover:bg-ds-surface-2 cursor-pointer transition-colors"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="text-xs font-bold text-ds-muted block uppercase tracking-wide">
                  Total : {expensesTab === 'daily' ? dailySuppliesRecords.length : filteredSupplies.length} enregistrements
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="flex items-center gap-2 px-4 py-2.5 bg-ds-surface-2 hover:bg-ds-surface-2 text-ds-text rounded-xl text-xs font-black uppercase tracking-wider cursor-pointer transition-all active:scale-[0.98] border border-ds-border shadow-xs"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Retour au Tableau de bord
                </button>

                <button
                  type="button"
                  onClick={exportExpensesToExcel}
                  className="flex items-center gap-2 px-4 py-2.5 bg-ds-success hover:bg-ds-success text-ds-brand-contrast rounded-xl text-xs font-black uppercase tracking-wider cursor-pointer transition-all active:scale-[0.98] shadow-md shadow-ds-sm hover:scale-[1.01]"
                >
                  <Download className="w-4 h-4" />
                  Exporter Excel
                </button>
              </div>

            </div>

          </div>
        </div>
      )}

      {/* SUB-MODAL FOR MODIFYING SUPPLY INPUT */}
      {editingSupply && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-ds-text/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-ds-surface rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden border border-ds-border p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-ds-border pb-3">
              <h3 className="text-sm font-black text-ds-text uppercase tracking-wider">
                Modifier l'approvisionnement
              </h3>
              <button 
                onClick={() => setEditingSupply(null)}
                className="p-1 text-ds-muted hover:text-ds-muted rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={handleUpdateSupply} className="space-y-4">
              <div>
                <p className="text-[10px] text-ds-muted font-extrabold uppercase mb-2">
                  Produit : <span className="text-ds-text font-bold">{editingSupply.productName}</span>
                </p>
              </div>
              
              <div>
                <label className="block text-xs font-black uppercase tracking-wider text-ds-muted mb-1">
                  Quantité d'approvisionnement
                </label>
                <input
                  type="number"
                  required
                  min="1"
                  value={editingSupplyQty}
                  onChange={(e) => setEditingSupplyQty(e.target.value)}
                  className="w-full px-4 py-2 border border-ds-border rounded-xl focus:ring-2 focus:ring-ds-brand/15 focus:border-ds-brand outline-none text-base font-bold sm:text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-black uppercase tracking-wider text-ds-muted mb-1">
                  Prix d'achat unitaire ({currency})
                </label>
                <input
                  type="number"
                  step="0.001"
                  required
                  min="0.001"
                  value={editingSupplyPrice}
                  onChange={(e) => setEditingSupplyPrice(e.target.value)}
                  className="w-full px-4 py-2 border border-ds-border rounded-xl focus:ring-2 focus:ring-ds-brand/15 focus:border-ds-brand outline-none text-base font-bold sm:text-xs font-mono"
                />
              </div>

              <div className="flex gap-3 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setEditingSupply(null)}
                  className="px-4 py-2 bg-ds-surface-2 hover:bg-ds-surface-2 text-ds-muted text-xs font-bold uppercase tracking-wider rounded-xl transition-colors cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-ds-brand hover:bg-ds-brand text-ds-brand-contrast text-xs font-black uppercase tracking-wider rounded-xl transition-all shadow-md shadow-ds-sm cursor-pointer active:scale-[0.98]"
                >
                  Enregistrer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* RENDER INVISIBLE PRINTABLE REPORT VIA REACT PORTAL */}
      {activeModal && activeModal !== 'expenses' && createPortal(
        <PrintableReport 
          activeModal={activeModal} 
          records={activeModal === 'stock' ? filteredAndSortedProducts : filteredAndSortedRecords} 
          storeSettings={storeSettings} 
          currency={currency} 
          canViewBuyPrice={canShowBuyPrice}
          canViewCosts={canShowMargin}
        />,
        document.body
      )}
    </div>
  );
}
