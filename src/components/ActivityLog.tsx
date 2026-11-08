import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import type { UserProfile } from '../types';
import { auditDate } from '../lib/audit';
import { Button, Card, Select } from './ui';

interface ActivityLogProps {
  userProfile: UserProfile | null;
}

interface AuditRecord {
  id: string;
  entity: 'invoice' | 'sale' | 'product';
  entityId: string;
  action: 'create' | 'update' | 'cancel' | 'delete';
  actor: { uid: string; name: string; role: string };
  date: unknown;
  summary?: { before?: Record<string, unknown>; after?: Record<string, unknown> };
}

const PAGE_SIZE = 20;

function recordDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    const parsed = value.toDate();
    return parsed instanceof Date && !Number.isNaN(parsed.getTime()) ? parsed : null;
  }
  return null;
}

export default function ActivityLog({ userProfile }: ActivityLogProps) {
  const ownerId = userProfile?.ownerId || userProfile?.uid || '';
  const isAdmin = userProfile?.role === 'admin';
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [entityFilter, setEntityFilter] = useState('all');
  const [userFilter, setUserFilter] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(0);

  useEffect(() => {
    if (!isAdmin || !ownerId) return;
    let active = true;
    setLoading(true);
    setError('');
    getDocs(query(collection(db, 'auditLogs'), where('ownerId', '==', ownerId)))
      .then(snapshot => {
        if (!active) return;
        const nextRecords = snapshot.docs.map(item => ({ id: item.id, ...item.data() } as AuditRecord));
        nextRecords.sort((a, b) => (recordDate(b.date)?.getTime() || 0) - (recordDate(a.date)?.getTime() || 0));
        setRecords(nextRecords);
      })
      .catch(cause => {
        console.error('Unable to load activity log:', cause);
        if (active) setError('Impossible de charger le journal d’activité. Vérifiez vos autorisations Firestore.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [isAdmin, ownerId]);

  const users = useMemo(() => {
    const distinctUsers = new Map<string, string>();
    records.forEach(record => {
      if (record.actor?.uid) distinctUsers.set(record.actor.uid, record.actor.name || record.actor.uid);
    });
    return [...distinctUsers.entries()];
  }, [records]);

  const filteredRecords = useMemo(() => records.filter(record => {
    if (entityFilter !== 'all' && record.entity !== entityFilter) return false;
    if (userFilter !== 'all' && record.actor?.uid !== userFilter) return false;
    const date = recordDate(record.date);
    if (!date) return false;
    if (fromDate && date < new Date(`${fromDate}T00:00:00`)) return false;
    if (toDate && date > new Date(`${toDate}T23:59:59.999`)) return false;
    return true;
  }), [records, entityFilter, userFilter, fromDate, toDate]);

  const pageCount = Math.max(1, Math.ceil(filteredRecords.length / PAGE_SIZE));
  const pageRecords = filteredRecords.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const updateFilter = (update: () => void) => {
    update();
    setPage(0);
  };

  if (!isAdmin) return null;

  return (
    <Card className="space-y-4">
      <div>
        <h3 className="text-sm font-black uppercase tracking-wider text-ds-text">Journal d’activité</h3>
        <p className="mt-1 text-sm text-ds-muted">Actions sur les produits, ventes et factures. Le journal est écrit côté client et n’est pas infalsifiable.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className="space-y-1 text-xs font-bold text-ds-text">
          Type
          <Select value={entityFilter} onChange={event => updateFilter(() => setEntityFilter(event.target.value))} className="text-base sm:text-sm">
            <option value="all">Tous les types</option>
            <option value="product">Produit</option>
            <option value="sale">Vente</option>
            <option value="invoice">Facture</option>
          </Select>
        </label>
        <label className="space-y-1 text-xs font-bold text-ds-text">
          Utilisateur
          <Select value={userFilter} onChange={event => updateFilter(() => setUserFilter(event.target.value))} className="text-base sm:text-sm">
            <option value="all">Tous les utilisateurs</option>
            {users.map(([uid, name]) => <option key={uid} value={uid}>{name}</option>)}
          </Select>
        </label>
        <label className="space-y-1 text-xs font-bold text-ds-text">
          Du
          <input type="date" value={fromDate} onChange={event => updateFilter(() => setFromDate(event.target.value))} className="min-h-11 w-full rounded-ds-md border border-ds-border bg-ds-surface px-3 text-base text-ds-text sm:text-sm" />
        </label>
        <label className="space-y-1 text-xs font-bold text-ds-text">
          Au
          <input type="date" value={toDate} onChange={event => updateFilter(() => setToDate(event.target.value))} className="min-h-11 w-full rounded-ds-md border border-ds-border bg-ds-surface px-3 text-base text-ds-text sm:text-sm" />
        </label>
      </div>

      {error && <p role="alert" className="rounded-ds-md bg-ds-danger-soft p-3 text-sm text-ds-danger">{error}</p>}
      {loading ? (
        <p role="status" className="py-4 text-center text-sm text-ds-muted">Chargement du journal…</p>
      ) : pageRecords.length === 0 ? (
        <p className="py-4 text-center text-sm text-ds-muted">Aucune activité pour ces filtres.</p>
      ) : (
        <div className="space-y-2">
          {pageRecords.map(record => {
            const details = record.summary?.after || record.summary?.before || {};
            const detailText = Object.entries(details).map(([key, value]) => `${key} : ${String(value)}`).join(' · ');
            return (
              <article key={record.id} className="grid grid-cols-1 gap-1 rounded-ds-md border border-ds-border bg-ds-surface-2 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-ds-text">{record.action} · {record.entity} · {record.actor?.name || 'Utilisateur inconnu'}</p>
                  <p className="break-words text-xs text-ds-muted">{record.entityId}{detailText ? ` · ${detailText}` : ''}</p>
                </div>
                <time className="text-xs text-ds-muted sm:text-right">{auditDate(record.date)}</time>
              </article>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 border-t border-ds-border pt-3">
        <span className="text-xs text-ds-muted">{filteredRecords.length} entrée(s) · page {page + 1}/{pageCount}</span>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" disabled={page === 0} onClick={() => setPage(current => Math.max(0, current - 1))}>Précédent</Button>
          <Button type="button" variant="secondary" disabled={page + 1 >= pageCount} onClick={() => setPage(current => Math.min(pageCount - 1, current + 1))}>Suivant</Button>
        </div>
      </div>
    </Card>
  );
}
