import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import type { Client } from '../../types';
import { handleFirestoreError, OperationType } from '../../App';
import { createClient } from '../../lib/clients';
import { Button, Card, Input } from '../ui';

interface QuickClientModalProps {
  clients: Client[];
  ownerId?: string;
  userId?: string;
  onCreated: (client: Client) => void;
  onClose: () => void;
}

function normalizedPhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

export default function QuickClientModal({
  clients,
  ownerId,
  userId,
  onCreated,
  onClose,
}: QuickClientModalProps) {
  const { t } = useTranslation('clients');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedName = name.trim();
    const normalizedPhoneValue = normalizedPhone(phone);
    if (!normalizedName) {
      setError(t('nameRequired'));
      return;
    }
    if (phone.trim() && (
      !/^\+?[\d\s().-]+$/.test(phone.trim()) ||
      normalizedPhoneValue.length < 7 ||
      normalizedPhoneValue.length > 15
    )) {
      setError(t('phoneInvalid'));
      return;
    }
    if (normalizedPhoneValue && clients.some(client =>
      normalizedPhone(client.phone || '') === normalizedPhoneValue,
    )) {
      setError(t('duplicatePhone'));
      return;
    }
    if (!ownerId) {
      setError(t('storeUnknown'));
      return;
    }

    setSaving(true);
    setError('');
    try {
      const client = await createClient({
        name: normalizedName,
        code: '',
        phone: phone.trim(),
        address: address.trim(),
        debt: 0,
      }, ownerId, userId || ownerId);
      onCreated(client);
    } catch (createError) {
      handleFirestoreError(createError, OperationType.CREATE, 'clients');
      setError(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onMouseDown={event => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <Card
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-client-title"
        className="w-full max-w-md overflow-hidden p-0 shadow-ds-md"
      >
        <div className="flex items-center justify-between border-b border-ds-border bg-ds-surface-2 px-5 py-4">
          <h2 id="quick-client-title" className="text-lg font-bold text-ds-text">{t('newClient')}</h2>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving} aria-label={t('close')}>
            <X className="h-5 w-5" />
          </Button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          <Input
            label={t('fullName')}
            autoFocus
            required
            maxLength={120}
            value={name}
            onChange={event => setName(event.target.value)}
            placeholder={t('quickName')}
          />
          <Input
            label={t('phone')}
            type="tel"
            maxLength={30}
            value={phone}
            onChange={event => setPhone(event.target.value)}
            placeholder={t('phoneExample')}
          />
          <label className="grid gap-1.5 text-sm font-medium text-ds-text">
            {t('addressNotes')}
            <textarea
              rows={2}
              maxLength={500}
              value={address}
              onChange={event => setAddress(event.target.value)}
              className="w-full rounded-ds-md border border-ds-border bg-ds-surface px-3 py-2 text-base text-ds-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-ds-brand"
            />
          </label>
          {error && <p role="alert" className="text-sm font-medium text-ds-danger">{error}</p>}
          <div className="flex gap-3 pt-1">
            <Button type="button" variant="secondary" className="flex-1" onClick={onClose} disabled={saving}>
              {t('cancel')}
            </Button>
            <Button type="submit" className="flex-1" disabled={saving}>
              {saving ? t('saving') : t('quickCreate')}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
