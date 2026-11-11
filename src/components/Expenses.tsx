import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { collection, doc, onSnapshot, query, runTransaction, serverTimestamp, Timestamp, where } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CircleDollarSign, Plus, Search, X } from 'lucide-react';
import { auth, db } from '../firebase';
import { UserProfile } from '../types';
import { handleFirestoreError, OperationType } from '../App';
import { addCashSessionTotals, cashSessionOwnerId, requireOpenCashSession, useCashSession } from '../lib/cashSessions';
import { Badge, Button, Card, EmptyState, Input, PageHeader, Select } from './ui';
import { formatDateTime, formatNumber } from '../i18n/format';

interface Expense {
  id: string;
  ownerId: string;
  date: Timestamp | Date | string;
  label: string;
  category: string;
  amount: number;
  mode: string;
  createdAt?: Timestamp;
}

const CATEGORIES = ['Loyer', 'Transport', 'Salaires', 'Entretien', 'Téléphone / Internet', 'Autre'];
const PAYMENT_MODES = ['Espèces', 'Carte', 'Virement', 'Autre'];
const CATEGORY_KEYS: Record<string, string> = {
  'Loyer': 'rent',
  'Transport': 'transport',
  'Salaires': 'salaries',
  'Entretien': 'maintenance',
  'Téléphone / Internet': 'phoneInternet',
  'Autre': 'other',
};
const PAYMENT_MODE_KEYS: Record<string, string> = {
  'Espèces': 'cash',
  'Carte': 'card',
  'Virement': 'transfer',
  'Autre': 'other',
};

function toDate(value: Expense['date']): Date {
  if (value instanceof Timestamp) return value.toDate();
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

export default function Expenses({ userProfile }: { userProfile: UserProfile | null }) {
  const { t } = useTranslation('expenses');
  const navigate = useNavigate();
  const ownerId = cashSessionOwnerId(userProfile);
  const { session, loading: cashSessionLoading } = useCashSession(userProfile);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState('month');
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState(PAYMENT_MODES[0]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);

  useEffect(() => {
    if (userProfile?.role !== 'admin' || !ownerId || !auth.currentUser) {
      setExpenses([]);
      setLoading(false);
      return;
    }
    return onSnapshot(
      query(collection(db, 'expenses'), where('ownerId', '==', ownerId)),
      snapshot => {
        const records = snapshot.docs.map(item => ({ id: item.id, ...item.data() } as Expense));
        records.sort((a, b) => toDate(b.date).getTime() - toDate(a.date).getTime());
        setExpenses(records);
        setLoading(false);
      },
      err => {
        setLoading(false);
        handleFirestoreError(err, OperationType.LIST, 'expenses');
      },
    );
  }, [ownerId, userProfile?.role]);

  const filteredExpenses = useMemo(() => {
    return expenses.filter(expense => {
      const expenseDate = toDate(expense.date);
      const monthMatch = period === 'all' ||
        `${expenseDate.getFullYear()}-${String(expenseDate.getMonth() + 1).padStart(2, '0')}` === selectedMonth;
      const queryText = search.trim().toLocaleLowerCase('fr');
      const searchMatch = !queryText ||
        expense.label.toLocaleLowerCase('fr').includes(queryText) ||
        expense.category.toLocaleLowerCase('fr').includes(queryText) ||
        expense.mode.toLocaleLowerCase('fr').includes(queryText);
      return monthMatch && searchMatch;
    });
  }, [expenses, period, selectedMonth, search]);

  const periodSummary = useMemo(() => {
    const [year, month] = selectedMonth.split('-').map(Number);
    const records = period === 'all' ? expenses : expenses.filter(expense => {
      const expenseDate = toDate(expense.date);
      return expenseDate.getFullYear() === year && expenseDate.getMonth() === month - 1;
    });
    return {
      total: records.reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0),
      count: records.length,
    };
  }, [expenses, selectedMonth, period]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setMessage('');
    const parsedAmount = Number(amount.replace(',', '.'));
    if (!ownerId || userProfile?.role !== 'admin') {
      setError(t('errors.adminOnly'));
      return;
    }
    if (!label.trim() || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError(t('errors.invalidExpense'));
      return;
    }
    setSaving(true);
    try {
      const expenseRef = doc(collection(db, 'expenses'));
      await runTransaction(db, async transaction => {
        const activeSession = await requireOpenCashSession(transaction, userProfile.uid, ownerId);
        transaction.set(expenseRef, {
          ownerId,
          date: Timestamp.fromDate(new Date(`${date}T12:00:00`)),
          label: label.trim(),
          category,
          amount: Math.round(parsedAmount * 1000) / 1000,
          mode,
          sessionId: activeSession.id,
          createdAt: serverTimestamp(),
          createdBy: userProfile.uid,
        });
        const amountToRecord = Math.round(parsedAmount * 1000) / 1000;
        addCashSessionTotals(transaction, activeSession, {
          expenses: amountToRecord,
          expensesCash: mode === 'Espèces' ? amountToRecord : 0,
        });
      });
      setLabel('');
      setAmount('');
      setMessage(t('saved'));
      setIsFormOpen(false);
    } catch (cause) {
      const messageText = cause instanceof Error ? cause.message : t('errors.unknown');
      setError(t('errors.saveFailed', { message: messageText }));
    } finally {
      setSaving(false);
    }
  };

  if (userProfile?.role !== 'admin') {
    return <Badge variant="warning" className="min-h-0 rounded-ds-md p-6 text-sm">{t('accessDenied')}</Badge>;
  }

  return (
    <div className="mx-auto min-w-0 max-w-6xl space-y-6">
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={<div className="flex min-w-0 flex-wrap items-center gap-3">
          <Card className="px-5 py-3 text-end">
            <p className="text-xs font-bold uppercase tracking-wider text-ds-text-muted">
              {period === 'all' ? t('allExpensesTotal') : t('monthExpensesTotal')}
            </p>
            <p className="mt-1 font-mono text-xl font-black text-ds-text">{formatNumber(periodSummary.total, { minimumFractionDigits: 3, maximumFractionDigits: 3 })} DT</p>
            <p className="text-xs font-semibold text-ds-text-muted">{t(periodSummary.count === 1 ? 'operation_one' : 'operation_other', { count: periodSummary.count })}</p>
          </Card>
          <Button type="button" onClick={() => { setError(''); setMessage(''); setIsFormOpen(true); }} disabled={!session}
            className="w-full sm:w-auto">
            <Plus className="h-4 w-4" /> {t('newExpense')}
          </Button>
        </div>}
      />

      {!session && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-ds-md border border-ds-warning/20 bg-ds-warning-soft p-3 text-sm font-semibold text-ds-warning">
        <span>{cashSessionLoading ? t('cashChecking') : t('cashRequired')}</span>
        {!cashSessionLoading && <Button type="button" variant="secondary" size="sm" onClick={() => navigate('/cash-session')}>{t('openCash')}</Button>}
      </div>}

      {message && <Badge variant="success" role="status" className="min-h-0 rounded-ds-md">{message}</Badge>}

      {isFormOpen && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ds-text/40 p-4" onMouseDown={event => {
        if (event.target === event.currentTarget && !saving) setIsFormOpen(false);
      }}>
      <form onSubmit={submit} className="grid w-full min-w-0 max-w-3xl gap-4 rounded-ds-lg border border-ds-border bg-ds-surface p-5 shadow-ds-md sm:p-6 md:grid-cols-6">
        <div className="flex items-start justify-between gap-3 border-b border-ds-border pb-3 md:col-span-6">
          <div>
            <h2 className="text-lg font-black text-ds-text">{t('newExpense')}</h2>
            <p className="mt-1 text-xs text-ds-muted">{t('linkedToCash')}</p>
          </div>
          <Button type="button" variant="ghost" onClick={() => setIsFormOpen(false)} disabled={saving} aria-label={t('close')}><X className="h-5 w-5" /></Button>
        </div>
        <Input label={t('label')} value={label} onChange={event => setLabel(event.target.value)} className="md:col-span-2" required maxLength={120} />
        <Input label={t('date')} type="date" value={date} onChange={event => setDate(event.target.value)} required />
        <Select label={t('category')} value={category} onChange={event => setCategory(event.target.value)}>
            {CATEGORIES.map(value => <option key={value} value={value}>{t(`categories.${CATEGORY_KEYS[value]}`)}</option>)}
        </Select>
        <Input label={t('amount')} type="number" min="0.001" step="0.001" value={amount} onChange={event => setAmount(event.target.value)} required />
        <Select label={t('paymentMode')} value={mode} onChange={event => setMode(event.target.value)}>
            {PAYMENT_MODES.map(value => <option key={value} value={value}>{t(`paymentModes.${PAYMENT_MODE_KEYS[value]}`)}</option>)}
        </Select>
        <div className="flex items-end md:col-span-2">
          <Button type="submit" disabled={saving || !session} className="w-full">
            {saving ? t('saving') : t('saveExpense')}
          </Button>
        </div>
        {error && <p role="alert" className="text-sm font-semibold text-ds-danger md:col-span-6">{error}</p>}
      </form>
      </div>}

      <Card className="min-w-0 overflow-hidden p-0">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-ds-border p-4">
          <div className="relative min-w-0 flex-1 sm:min-w-52">
            <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ds-muted" />
            <Input value={search} onChange={event => setSearch(event.target.value)} placeholder={t('search')} className="ps-9" />
          </div>
          <label className="flex min-h-ds-touch-target items-center gap-2 rounded-ds-md border border-ds-border px-3 text-sm font-semibold text-ds-text">
            <input type="checkbox" checked={period === 'all'} onChange={event => setPeriod(event.target.checked ? 'all' : 'month')} className="h-4 w-4 rounded border-ds-border accent-ds-brand" />
            {t('all')}
          </label>
          {period === 'month' && (
              <Input type="month" value={selectedMonth} onChange={event => setSelectedMonth(event.target.value)} aria-label={t('monthAria')} />
          )}
        </div>
          {loading ? <EmptyState title={t('loading')} /> :
          filteredExpenses.length === 0 ? (
              <EmptyState icon={<CircleDollarSign className="h-9 w-9" />} title={t('empty')} />
          ) : (
            <div className="overflow-x-auto">
              <table className="responsive-card-table w-full text-start text-sm">
                <thead className="bg-ds-surface-2 text-xs uppercase tracking-wider text-ds-muted">
                  <tr><th className="px-4 py-3">{t('descriptionDate')}</th><th className="px-4 py-3">{t('descriptionLabel')}</th><th className="px-4 py-3">{t('descriptionCategory')}</th><th className="px-4 py-3">{t('descriptionMode')}</th><th className="px-4 py-3 text-end">{t('amountColumn')}</th></tr>
                </thead>
                <tbody className="divide-y divide-ds-border">
                  {filteredExpenses.map(expense => (
                    <tr key={expense.id} className="hover:bg-ds-surface-2">
                      <td data-label={t('descriptionDate')} className="whitespace-nowrap px-4 py-3">{formatDateTime(toDate(expense.date), { dateStyle: 'short' })}</td>
                      <td data-label={t('descriptionLabel')} className="px-4 py-3 font-semibold text-ds-text">{expense.label}</td>
                      <td data-label={t('descriptionCategory')} className="px-4 py-3"><Badge variant="neutral" className="min-h-0 px-2 py-0.5">{t(`categories.${CATEGORY_KEYS[expense.category] || 'other'}`)}</Badge></td>
                      <td data-label={t('descriptionMode')} className="px-4 py-3">{t(`paymentModes.${PAYMENT_MODE_KEYS[expense.mode] || 'other'}`)}</td>
                      <td data-label={t('amountColumn')} className="px-4 py-3 text-end font-mono font-bold text-ds-text">{formatNumber(Number(expense.amount), { minimumFractionDigits: 3, maximumFractionDigits: 3 })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </Card>
    </div>
  );
}
