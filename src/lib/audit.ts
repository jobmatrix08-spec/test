import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import type { UserProfile } from '../types';

export type AuditEntity = 'invoice' | 'sale' | 'product';
export type AuditAction = 'create' | 'update' | 'cancel' | 'delete';

export interface AuditActor {
  uid: string;
  name: string;
  role: 'admin' | 'casier' | 'technicien' | 'unknown';
}

export interface AuditSummary {
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

export function getAuditActor(profile: UserProfile | null, fallbackUid = 'unknown'): AuditActor {
  const isTechnician = !!profile?.allowedMenus?.includes('reparation') && !profile.allowedMenus.includes('products');
  return {
    uid: profile?.uid || fallbackUid,
    name: profile?.name?.trim() || profile?.email || profile?.uid || fallbackUid,
    role: profile?.role === 'admin' ? 'admin' : profile ? (isTechnician ? 'technicien' : 'casier') : 'unknown',
  };
}

export async function logAudit(input: {
  ownerId: string | undefined;
  entity: AuditEntity;
  entityId: string;
  action: AuditAction;
  actor: AuditActor;
  summary: AuditSummary;
}): Promise<void> {
  if (!input.ownerId) return;
  try {
    await addDoc(collection(db, 'auditLogs'), {
      ...input,
      date: serverTimestamp(),
    });
  } catch {
    // Audit failures must not block the business operation.
  }
}

export function auditName(value?: string | AuditActor | null): string {
  if (!value) return '';
  return typeof value === 'string' ? value : value.name;
}

export function auditDate(value: unknown): string {
  let date: Date | null = null;
  if (value instanceof Date) date = value;
  else if (typeof value === 'string' || typeof value === 'number') date = new Date(value);
  else if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    date = value.toDate();
  }
  return date && !Number.isNaN(date.getTime())
    ? new Intl.DateTimeFormat('fr-TN', { dateStyle: 'short', timeStyle: 'short' }).format(date)
    : '';
}
