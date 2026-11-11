import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, User, UserCheck } from 'lucide-react';
import type { Client } from '../../types';
import { cn } from '../../lib/utils';
import { Button, Input } from '../ui';

interface ClientPickerProps {
  clients: Client[];
  selectedClient: Client | null;
  onSelect: (client: Client | null) => void;
}

export default function ClientPicker({ clients, selectedClient, onSelect }: ClientPickerProps) {
  const { t } = useTranslation('pos');
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (event.target instanceof Node && !pickerRef.current?.contains(event.target)) {
        setIsOpen(false);
        setSearch('');
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const filteredClients = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    const normalizedPhoneSearch = search.replace(/\D/g, '');
    if (!normalizedSearch) return clients;
    return clients.filter(client =>
      client.name.toLocaleLowerCase().includes(normalizedSearch) ||
      (client.phone || '').toLocaleLowerCase().includes(normalizedSearch) ||
      (normalizedPhoneSearch.length > 0 && (client.phone || '').replace(/\D/g, '').includes(normalizedPhoneSearch)),
    );
  }, [clients, search]);

  const selectClient = (client: Client | null) => {
    onSelect(client);
    setIsOpen(false);
    setSearch('');
  };

  return (
    <div ref={pickerRef} className="relative min-w-0 flex-1">
      <Button
        type="button"
        variant="secondary"
        className="w-full min-w-0 justify-between"
        aria-label={t('chooseClient')}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        onClick={() => setIsOpen(open => !open)}
      >
        <span className="flex min-w-0 items-center gap-2 text-start">
          <UserCheck className="h-4 w-4 shrink-0 text-ds-text-muted" />
          <span className="min-w-0">
            <span className="block truncate font-semibold text-ds-text">
              {selectedClient?.name || t('walkInCustomer')}
            </span>
            {selectedClient?.phone && (
              <span className="block truncate text-xs font-normal text-ds-text-muted">{selectedClient.phone}</span>
            )}
          </span>
        </span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform', isOpen && 'rotate-180')} />
      </Button>

      {isOpen && (
        <div className="absolute start-0 end-0 top-full z-[70] mt-1 overflow-hidden rounded-ds-md border border-ds-border bg-ds-surface shadow-ds-md">
          <div className="border-b border-ds-border p-2">
            <Input
              type="search"
              autoFocus
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder={t('searchClient')}
              aria-label={t('searchClientAria')}
            />
          </div>
          <div role="listbox" aria-label={t('clients')} className="max-h-60 overflow-y-auto p-1">
            <button
              type="button"
              role="option"
              aria-selected={!selectedClient}
              onClick={() => selectClient(null)}
              className="flex min-h-11 w-full items-center gap-2 rounded-ds-sm px-3 py-2 text-start text-sm text-ds-text hover:bg-ds-surface-2"
            >
              <User className="h-4 w-4 shrink-0 text-ds-text-muted" />
              <span className="flex-1">{t('walkInCustomer')}</span>
              {!selectedClient && <Check className="h-4 w-4 text-ds-brand" />}
            </button>
            {filteredClients.map(client => (
              <button
                key={client.id}
                type="button"
                role="option"
                aria-selected={selectedClient?.id === client.id}
                onClick={() => selectClient(client)}
                className="flex min-h-11 w-full items-center gap-2 rounded-ds-sm px-3 py-2 text-start text-sm text-ds-text hover:bg-ds-surface-2"
              >
                <User className="h-4 w-4 shrink-0 text-ds-text-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{client.name}</span>
                  <span className="block truncate text-xs text-ds-text-muted">{client.phone || t('phoneNotProvided')}</span>
                </span>
                {selectedClient?.id === client.id && <Check className="h-4 w-4 shrink-0 text-ds-brand" />}
              </button>
            ))}
            {filteredClients.length === 0 && (
              <p className="px-3 py-4 text-center text-sm text-ds-text-muted">{t('noClientFound')}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
