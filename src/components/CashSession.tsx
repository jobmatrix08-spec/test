import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { CircleDollarSign, Printer } from 'lucide-react';
import { auth, db } from '../firebase';
import { cashSessionOwnerId, closeCashSession, openCashSession, useCashSession } from '../lib/cashSessions';
import { computeExpectedCash } from '../lib/cashSessionMath';
import type { CashSession as CashSessionRecord, UserProfile } from '../types';
import { useTranslation } from 'react-i18next';
import { formatDateTime, formatMoney } from '../i18n/format';
import { Button, Card, PageHeader } from './ui';

function asDate(value: any): Date {
  if (value?.toDate) return value.toDate();
  const result = value instanceof Date ? value : new Date(value || 0);
  return Number.isNaN(result.getTime()) ? new Date(0) : result;
}

function formatDate(value: any): string {
  return formatDateTime(asDate(value));
}

function formatAmount(value: number): string {
  return formatMoney(value);
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
  const [closedDifference, setClosedDifference] = useState<number | null>(null);
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
      setClosedDifference(null);
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
      setClosedDifference(result.difference);
      setMessage(t('closeSuccess'));
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
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={session && <Button data-ui="secondary" variant="secondary" type="button" onClick={() => window.print()}>
          <Printer className="h-4 w-4" /> {t('print')}
        </Button>}
      />

      {activeSessionError && <p role="alert" className="rounded-ds-md border border-ds-danger bg-ds-danger-soft px-3 py-2 text-sm font-semibold text-ds-danger">{activeSessionError}</p>}
      {loading ? <p className="text-sm text-ds-muted">{t('loading')}</p> : session ? (
        <Card className="space-y-5 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-bold text-ds-text">{t('opened')}</h2>
              <p className="mt-1 text-xs text-ds-muted">{t('openedAt', { date: formatDate(session.openedAt), cashier: session.openedBy })}</p>
            </div>
            <span className="rounded-full bg-ds-success-soft px-3 py-1 text-xs font-bold text-ds-success">{t('openStatus')}</span>
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
              <div key={label} className="flex min-h-20 flex-col rounded-ds-md border border-ds-border bg-ds-surface-2 p-3">
                <p className="text-xs font-semibold text-ds-muted">{t(`metrics.${label}`)}</p>
                <p className="mt-auto pt-2 text-sm font-bold text-ds-text"><bdi dir="ltr">{formatAmount(Number(amount))} DT</bdi></p>
              </div>
            ))}
          </div>
          <form onSubmit={closeSession} className="flex flex-wrap items-end gap-3 border-t border-ds-border pt-4">
            <label className="min-w-56 flex-1">
              <span className="mb-1 block text-sm font-medium text-ds-text">{t('counted')}</span>
              <input type="number" min="0" step="0.001" value={countedInput} onChange={event => setCountedInput(event.target.value)} className="w-full rounded-ds-md border border-ds-border bg-ds-surface px-3 py-2.5 text-ds-text" required />
            </label>
            <p className="pb-2 text-sm font-semibold text-ds-muted">
              {t('differenceLabel')} <bdi dir="ltr">{formatAmount(Number(countedInput || 0) - currentExpected)} DT</bdi>
            </p>
            <Button type="submit" variant="primary" disabled={saving}>{saving ? t('closing') : t('close')}</Button>
          </form>
        </Card>
      ) : (
        <form onSubmit={openSession} className="flex flex-wrap items-end gap-3 rounded-ds-lg border border-ds-border bg-ds-surface p-4 shadow-ds-sm sm:p-5">
          <div className="me-auto">
            <h2 className="font-bold text-ds-text">{t('noneOpen')}</h2>
            <p className="mt-1 text-sm text-ds-muted">{t('openDescription')}</p>
          </div>
          <label>
            <span className="mb-1 block text-sm font-medium text-ds-text">{t('openingFloat')}</span>
            <input type="number" min="0" step="0.001" value={openingInput} onChange={event => setOpeningInput(event.target.value)} className="rounded-ds-md border border-ds-border bg-ds-surface px-3 py-2.5 text-ds-text" required />
          </label>
          <Button type="submit" variant="primary" disabled={saving}>
            <CircleDollarSign className="h-4 w-4" /> {saving ? t('opening') : t('open')}
          </Button>
        </form>
      )}

      {(formError || message) && <p role={formError ? 'alert' : 'status'} className={`rounded-ds-md border px-3 py-2 text-sm font-semibold ${formError ? 'border-ds-danger bg-ds-danger-soft text-ds-danger' : 'border-ds-success bg-ds-success-soft text-ds-success'}`}>
        {formError || (closedDifference === null
          ? message
          : <>{message} {t('differenceLabel')} <bdi dir="ltr">{formatAmount(closedDifference)} DT</bdi></>)}
      </p>}

      <Card className="space-y-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-bold text-ds-text">{t('history')}</h2>
          {isAdmin && <div className="flex flex-wrap gap-2">
            <input aria-label={t('cashierFilter')} placeholder={t('cashierPlaceholder')} value={cashierFilter} onChange={event => setCashierFilter(event.target.value)} className="rounded-ds-md border border-ds-border bg-ds-surface px-3 py-2 text-sm text-ds-text" />
            <input aria-label={t('dateFilter')} type="date" value={dateFilter} onChange={event => setDateFilter(event.target.value)} className="rounded-ds-md border border-ds-border bg-ds-surface px-3 py-2 text-sm text-ds-text" />
          </div>}
        </div>
        {historyError && <p role="alert" className="text-sm text-ds-danger">{historyError}</p>}
        <div className="overflow-x-auto">
          <table className="responsive-card-table w-full text-start text-sm text-ds-text">
          <thead><tr className="border-b border-ds-border text-xs uppercase text-ds-muted">
              <th className="py-2">{t('columns.opened')}</th><th>{t('columns.cashier')}</th><th>{t('columns.sales')}</th><th>{t('columns.cash')}</th><th>{t('columns.expenses')}</th><th>{t('columns.expected')}</th><th>{t('columns.counted')}</th><th>{t('columns.difference')}</th><th>{t('columns.status')}</th>
            </tr></thead>
            <tbody>{filteredHistory.map(record => (
              <tr key={record.id} className="border-b border-ds-border">
                <td data-label={t('columns.opened')} className="py-3">{formatDate(record.openedAt)}</td><td data-label={t('columns.cashier')}>{record.openedBy}</td>
                <td data-label={t('columns.sales')}><bdi dir="ltr">{formatAmount(Number(record.totals?.sales || 0))} DT</bdi></td>
                <td data-label={t('columns.cash')}><bdi dir="ltr">{formatAmount(Number(record.totals?.cash || 0))} DT</bdi></td>
                <td data-label={t('columns.expenses')}><bdi dir="ltr">{formatAmount(Number(record.totals?.expenses || 0))} DT</bdi></td>
                <td data-label={t('columns.expected')}><bdi dir="ltr">{formatAmount(record.status === 'closed' ? Number(record.expectedCash || 0) : computeExpectedCash(record))} DT</bdi></td>
                <td data-label={t('columns.counted')}>{record.countedCash === undefined ? '—' : <bdi dir="ltr">{formatAmount(record.countedCash)} DT</bdi>}</td>
                <td data-label={t('columns.difference')}>{record.difference === undefined ? '—' : <bdi dir="ltr">{formatAmount(record.difference)} DT</bdi>}</td>
                <td data-label={t('columns.status')} className={record.status === 'open' ? 'font-bold text-emerald-700' : 'font-semibold text-slate-500'}>{record.status === 'open' ? t('openStatus') : t('closedStatus')}</td>
              </tr>
            ))}</tbody>
          </table>
          {filteredHistory.length === 0 && <p className="py-6 text-center text-sm text-ds-muted">{t('noHistory')}</p>}
        </div>
      </Card>
    </div>
  );
}
