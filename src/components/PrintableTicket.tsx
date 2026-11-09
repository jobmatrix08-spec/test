import React, { forwardRef, useEffect, useState } from 'react';
import { Invoice, StoreSettings } from '../types';
import { doc, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { getInvoiceTotals } from '../lib/financial';
import { formatProductDetails } from '../config/productAttributes';
import { auditName } from '../lib/audit';
import { useBrand } from './BrandProvider';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '../i18n/format';

interface Props {
  invoice: Invoice;
  ownerId?: string;
}

export const PrintableTicket = forwardRef<HTMLDivElement, Props>(({ invoice, ownerId }, ref) => {
  const { t } = useTranslation('settings');
  const brand = useBrand();
  const [storeSettings, setStoreSettings] = useState<StoreSettings | null>(null);

  useEffect(() => {
    if (!auth.currentUser) return;
    const finalOwnerId = ownerId || invoice.ownerId || 'store';
    const unsubscribe = onSnapshot(
      doc(db, 'settings', finalOwnerId),
      (snapshot) => {
        if (snapshot.exists()) setStoreSettings(snapshot.data() as StoreSettings);
      },
      (error) => console.error('Unable to load ticket store settings:', error),
    );
    return unsubscribe;
  }, [ownerId, invoice.ownerId]);

  const invoiceDate = invoice.date && typeof invoice.date.toDate === 'function'
    ? invoice.date.toDate()
    : invoice.date instanceof Date || typeof invoice.date === 'string'
      ? new Date(invoice.date)
      : new Date();
  const dateStr = formatDateTime(Number.isNaN(invoiceDate.getTime()) ? new Date() : invoiceDate, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const storeName = storeSettings?.storeName || brand.storeName;
  const storeAddress = storeSettings?.address || '';
  const storePhone = storeSettings?.phone || '';
  const currency = storeSettings?.currency || 'DT';
  const totals = getInvoiceTotals(invoice);
  const sellerName = typeof invoice.createdBy === 'object' && invoice.createdBy
    ? auditName(invoice.createdBy).trim()
    : '';
  const sellerMode = storeSettings?.sellerMentionMode || 'initial';
  const sellerLabel = sellerMode === 'initial'
    ? `${Array.from(sellerName)[0]?.toLocaleUpperCase() || ''}.`
    : sellerMode === 'shortName'
      ? sellerName.split(/\s+/)[0] || ''
      : '';

  return (
    <div ref={ref} className="p-5 w-[80mm] mx-auto bg-white text-black font-mono text-[12px] leading-tight">
      <div className="text-center font-bold text-[16px] uppercase">{storeName}</div>
      {storeAddress && <div className="text-center">{storeAddress}</div>}
      {storePhone && <div className="text-center">Tél: {storePhone}</div>}
      <div className="border-t border-dashed border-black my-1"></div>
      <div className="text-center font-bold">TICKET DE CAISSE</div>
      <div className="border-t border-dashed border-black my-1"></div>
      <div>Date: {dateStr}</div>
      <div>Ticket: {invoice.number}</div>
      <div>Client: {invoice.clientName}</div>
      {invoice.clientCode && <div>Code client: {invoice.clientCode}</div>}
      {invoice.clientPhone && <div>Tél: {invoice.clientPhone}</div>}
      {sellerLabel && sellerMode !== 'none' && <div style={{ color: '#000000' }}>{t('sellerServedBy', { name: sellerLabel })}</div>}
      <div className="border-t border-dashed border-black my-1"></div>
      <div className="my-2 space-y-1">
        {invoice.items.map((item, index) => (
          <div key={index}>
            <div className="flex justify-between">
              <span className="max-w-[40mm] overflow-hidden text-ellipsis whitespace-nowrap">{item.name}</span>
              <span>{item.quantity} x {item.price.toFixed(3)}</span>
            </div>
            {formatProductDetails(item.attributes, item.serialNumber) && (
              <div className="text-[10px] leading-tight">{formatProductDetails(item.attributes, item.serialNumber)}</div>
            )}
            <div className="text-right">{item.total.toFixed(3)} {currency}</div>
          </div>
        ))}
      </div>
      <div className="border-t border-dashed border-black my-1"></div>
      {totals.tvaVisible && (
        <>
          <div className="flex justify-between">
            <span>Sous-total</span>
            <span>{totals.subtotal.toFixed(3)} {currency}</span>
          </div>
          {totals.discount > 0 && (
            <div className="flex justify-between">
              <span>Remise</span>
              <span>-{totals.discount.toFixed(3)} {currency}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span>TVA</span>
            <span>{totals.tva.toFixed(3)} {currency}</span>
          </div>
        </>
      )}
      <div className="flex justify-between font-bold">
        <span>TOTAL</span>
        <span>{totals.total.toFixed(3)} {currency}</span>
      </div>
      <div className="flex justify-between">
        <span>Payé</span>
        <span>{invoice.paid.toFixed(3)} {currency}</span>
      </div>
      <div className="flex justify-between">
        <span>Reste</span>
        <span>{invoice.debt.toFixed(3)} {currency}</span>
      </div>
      <div className="border-t border-dashed border-black my-1"></div>
      <div className="text-center mt-5 text-[10px]">
        Merci de votre visite !<br />
        À bientôt chez {storeName}
      </div>
    </div>
  );
});

PrintableTicket.displayName = 'PrintableTicket';
