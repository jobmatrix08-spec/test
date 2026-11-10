import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { CircleDollarSign, Printer } from 'lucide-react';
import { auth, db } from '../firebase';
import { cashSessionOwnerId, closeCashSession, openCashSession, useCashSession } from '../lib/cashSessions';
import { computeExpectedCash } from '../lib/cashSessionMath';
import type { CashSession as CashSessionRecord, UserProfile } from '../types';
import { useTranslation } from 'react-i18next';
import { formatDateTime, formatNumber } from '../i18n/format';

function asDate(value: any): Date {
  if (value?.toDate) return value.toDate();
  const result = value instanceof Date ? value : new Date(value || 0);
  return Number.isNaN(result.getTime()) ? new Date(0) : result;
}

function formatDate(value: any): string {
  return formatDateTime(asDate(value));
}

function formatAmount(value: number): string {
  return formatNumber(value, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

export default function CashSession({ userProfile }: { userProfile: UserProfile | null }) {
  const { t } = useTranslation('cashSession');
  const ownerId = cashSessionOwnerId(userProfile);
  const userId = userProfile?.uid || auth.currentUser?.uid;
  const isAdmin = userProfile?.role === 'admin';
  const { session, loading, error: activeSessionError } = useCashSession(userProfile);
  const [history, setHistory] = useState<CashSessionRecord[]>([]);
  const [historyError, setHistoryError] = useState('');
  const [openingInput, setOpeningInput] = useState('0.000');
  const [countedInput, setCountedInput] = useState('');
  const [cashierFilter, setCashierFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (!ownerId || !userId || !auth.currentUser) return;
    const sessionsQuery = isAdmin
      ? query(collection(db, 'cash_sessions'), where('ownerId', '==', ownerId))
      : query(collection(db, 'cash_sessions'), where('openedBy', '==', userId));
    return onSnapshot(sessionsQuery, snapshot => {
      const records = snapshot.docs.map(item => ({ id: item.id, ...item.data() } as CashSessionRecord));
      records.sort((a, b) => asDate(b.openedAt).getTime() - asDate(a.openedAt).getTime());
      setHistory(records);
      setHistoryError('');
    }, cause => {
      setHistoryError(cause instanceof Error ? cause.message : t('historyError'));
    });
  }, [ownerId, userId, isAdmin, t]);

  const filteredHistory = useMemo(() => history.filter(record => {
    const cashierMatch = !isAdmin || !cashierFilter.trim() ||
      record.openedBy.toLowerCase().includes(cashierFilter.trim().toLowerCase());
    const dateMatch = !dateFilter || asDate(record.openedAt).toISOString().slice(0, 10) === dateFilter;
    return cashierMatch && dateMatch;
  }), [history, isAdmin, cashierFilter, dateFilter]);

  const openSession = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError('');
    setMessage('');
    const openingFloat = Number(openingInput.replace(',', '.'));
    if (!userId || !ownerId || !Number.isFinite(openingFloat) || openingFloat < 0) {
      setFormError(t('invalidOpening'));
      return;
    }
    setSaving(true);
    try {
      await openCashSession(userId, ownerId, openingFloat);
      setMessage(t('openSuccess'));
    } catch (cause) {
      console.error('Unable to open the cash session.', cause);
      setFormError(cause instanceof Error ? cause.message : t('openError'));
    } finally {
      setSaving(false);
    }
  };

  const closeSession = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError('');
    setMessage('');
    const countedCash = Number(countedInput.replace(',', '.'));
    if (!userId || !session || !Number.isFinite(countedCash) || countedCash < 0) {
      setFormError(t('invalidCounted'));
      return;
    }
    if (!window.confirm(t('confirmClose'))) return;
    setSaving(true);
    try {
      const result = await closeCashSession(userId, session.id, countedCash);
      setMessage(t('closeSuccess', { amount: formatAmount(result.difference) }));
      setCountedInput('');
    } catch (cause) {
      console.error('Unable to close the cash session.', cause);
      setFormError(cause instanceof Error ? cause.message : t('closeError'));
    } finally {
      setSaving(false);
    }
  };

  const currentExpected = session ? computeExpectedCash(session) : 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-500">{t('section')}</p>
          <h1 className="mt-1 text-3xl font-black text-slate-900">{t('title')}</h1>
          <p className="mt-1 text-sm text-slate-500">{t('description')}</p>
        </div>
        {session && <button type="button" onClick={() => window.print()} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700">
          <Printer className="h-4 w-4" /> {t('print')}
        </button>}
      </header>

      {activeSessionError && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm font-semibold text-rose-700">{activeSessionError}</p>}
      {loading ? <p className="text-sm text-slate-500">{t('loading')}</p> : session ? (
        <section className="space-y-5 rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-black text-emerald-800">{t('opened')}</h2>
              <p className="text-xs text-slate-500">{t('openedAt', { date: formatDate(session.openedAt), cashier: session.openedBy })}</p>
            </div>
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-black uppercase text-emerald-800">{t('openStatus')}</span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              ['opening', session.openingFloat],
              ['sales', session.totals?.sales || 0],
              ['cashSales', session.totals?.cash || 0],
              ['debtsCollected', session.totals?.debtsCollected || 0],
              ['repairsCollected', session.totals?.repairsCollected || 0],
              ['expenses', session.totals?.expenses || 0],
              ['expected', currentExpected],
            ].map(([label, amount]) => (
              <div key={label} className="rounded-xl bg-slate-50 p-3">
                <p className="text-[10px] font-bold uppercase text-slate-400">{t(`metrics.${label}`)}</p>
                <p className="mt-1 font-mono text-sm font-black text-slate-800">{formatAmount(Number(amount))} DT</p>
              </div>
            ))}
          </div>
          <form onSubmit={closeSession} className="flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4">
            <label className="min-w-56 flex-1">
              <span className="mb-1 block text-xs font-bold text-slate-600">{t('counted')}</span>
              <input type="number" min="0" step="0.001" value={countedInput} onChange={event => setCountedInput(event.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5" required />
            </label>
            <p className="pb-2 text-sm font-bold text-slate-600">{t('difference', { amount: formatAmount(Number(countedInput || 0) - currentExpected) })}</p>
            <button disabled={saving} className="min-h-11 rounded-xl bg-ds-brand px-5 font-bold text-ds-brand-contrast hover:bg-ds-brand-hover disabled:opacity-50">{saving ? t('closing') : t('close')}</button>
          </form>
        </section>
      ) : (
        <form onSubmit={openSession} className="flex flex-wrap items-end gap-3 rounded-2xl border border-amber-200 bg-white p-5 shadow-sm">
          <div className="me-auto">
            <h2 className="text-lg font-black text-slate-900">{t('noneOpen')}</h2>
            <p className="mt-1 text-sm text-slate-500">{t('openDescription')}</p>
          </div>
          <label>
            <span className="mb-1 block text-xs font-bold text-slate-600">{t('openingFloat')}</span>
            <input type="number" min="0" step="0.001" value={openingInput} onChange={event => setOpeningInput(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2.5" required />
          </label>
          <button disabled={saving} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-indigo-600 px-5 font-bold text-white disabled:opacity-50">
            <CircleDollarSign className="h-4 w-4" /> {saving ? t('opening') : t('open')}
          </button>
        </form>
      )}

      {(formError || message) && <p role={formError ? 'alert' : 'status'} className={`rounded-xl p-3 text-sm font-semibold ${formError ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>{formError || message}</p>}

      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-black text-slate-900">{t('history')}</h2>
          {isAdmin && <div className="flex flex-wrap gap-2">
            <input aria-label={t('cashierFilter')} placeholder={t('cashierPlaceholder')} value={cashierFilter} onChange={event => setCashierFilter(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
            <input aria-label={t('dateFilter')} type="date" value={dateFilter} onChange={event => setDateFilter(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
          </div>}
        </div>
        {historyError && <p role="alert" className="text-sm text-rose-700">{historyError}</p>}
        <div className="overflow-x-auto">
          <table className="responsive-card-table w-full text-start text-sm">
            <thead><tr className="border-b text-xs uppercase text-slate-400">
              <th className="py-2">{t('columns.opened')}</th><th>{t('columns.cashier')}</th><th>{t('columns.sales')}</th><th>{t('columns.cash')}</th><th>{t('columns.expenses')}</th><th>{t('columns.expected')}</th><th>{t('columns.counted')}</th><th>{t('columns.difference')}</th><th>{t('columns.status')}</th>
            </tr></thead>
            <tbody>{filteredHistory.map(record => (
              <tr key={record.id} className="border-b border-slate-100">
                <td data-label={t('columns.opened')} className="py-3">{formatDate(record.openedAt)}</td><td data-label={t('columns.cashier')}>{record.openedBy}</td>
                <td data-label={t('columns.sales')}>{formatAmount(Number(record.totals?.sales || 0))} DT</td>
                <td data-label={t('columns.cash')}>{formatAmount(Number(record.totals?.cash || 0))} DT</td>
                <td data-label={t('columns.expenses')}>{formatAmount(Number(record.totals?.expenses || 0))} DT</td>
                <td data-label={t('columns.expected')}>{formatAmount(record.status === 'closed' ? Number(record.expectedCash || 0) : computeExpectedCash(record))} DT</td>
                <td data-label={t('columns.counted')}>{record.countedCash === undefined ? '—' : `${formatAmount(record.countedCash)} DT`}</td>
                <td data-label={t('columns.difference')}>{record.difference === undefined ? '—' : `${formatAmount(record.difference)} DT`}</td>
                <td data-label={t('columns.status')} className={record.status === 'open' ? 'font-bold text-emerald-700' : 'font-semibold text-slate-500'}>{record.status === 'open' ? t('openStatus') : t('closedStatus')}</td>
              </tr>
            ))}</tbody>
          </table>
          {filteredHistory.length === 0 && <p className="py-6 text-center text-sm text-slate-400">{t('noHistory')}</p>}
        </div>
      </section>
    </div>
  );
}
