import React, { forwardRef, useEffect, useState } from 'react';
import { Invoice, StoreSettings } from '../types';
import { doc, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { getInvoiceTotals } from '../lib/financial';
import { formatProductDetails } from '../config/productAttributes';
import { auditName } from '../lib/audit';
import { useBrand } from './BrandProvider';
import { formatDocumentDate } from '../i18n/format';

interface Props {
  invoice: Invoice;
  ownerId?: string;
}

export const PrintableTicket = forwardRef<HTMLDivElement, Props>(({ invoice, ownerId }, ref) => {
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
  const documentLanguage = storeSettings?.documentLanguage || 'fr';
  const date = Number.isNaN(invoiceDate.getTime()) ? new Date() : invoiceDate;
  const dateStr = formatDocumentDate(date, documentLanguage);
  const text = (french: string, arabic: string) => documentLanguage === 'both'
    ? `${french} / ${arabic}`
    : documentLanguage === 'ar' ? arabic : french;

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
    <div ref={ref} dir={documentLanguage === 'ar' ? 'rtl' : 'ltr'} className="p-5 w-[80mm] mx-auto bg-white text-black font-mono text-[12px] leading-tight">
      <div className="text-center font-bold text-[16px] uppercase">{storeName}</div>
      {storeAddress && <div className="text-center">{storeAddress}</div>}
      {storePhone && <div className="text-center">{text('Tél:', 'الهاتف:')} {storePhone}</div>}
      <div className="border-t border-dashed border-black my-1"></div>
      <div className="text-center font-bold">{text('TICKET DE CAISSE', 'وصل خلاص')}</div>
      <div className="border-t border-dashed border-black my-1"></div>
      <div>{text('Date :', 'التاريخ:')} {dateStr}</div>
      <div>{text('Ticket :', 'الوصل:')} {invoice.number}</div>
      <div>{text('Client :', 'الحريف:')} {invoice.clientName}</div>
      {invoice.clientCode && <div>{text('Code client :', 'كود الحريف:')} {invoice.clientCode}</div>}
      {invoice.clientPhone && <div>{text('Tél :', 'الهاتف:')} {invoice.clientPhone}</div>}
      {sellerLabel && sellerMode !== 'none' && <div style={{ color: '#000000' }}>{text('Servi par :', 'باعلك:')} {sellerLabel}</div>}
      <div className="border-t border-dashed border-black my-1"></div>
      <div className="my-2 space-y-1">
        {invoice.items.map((item, index) => (
          <div key={index}>
            <div className="flex justify-between">
              <span dir="auto" className="max-w-[40mm] overflow-hidden text-ellipsis whitespace-nowrap">{item.name}</span>
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
            <span>{text('Sous-total', 'المجموع قبل التخفيض')}</span>
            <span>{totals.subtotal.toFixed(3)} {currency}</span>
          </div>
          {totals.discount > 0 && (
            <div className="flex justify-between">
              <span>{text('Remise', 'تخفيض')}</span>
              <span>-{totals.discount.toFixed(3)} {currency}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span>{text('TVA', 'الأداء على القيمة المضافة')}</span>
            <span>{totals.tva.toFixed(3)} {currency}</span>
          </div>
        </>
      )}
      <div className="flex justify-between font-bold">
        <span>{text('TOTAL', 'المجموع')}</span>
        <span>{totals.total.toFixed(3)} {currency}</span>
      </div>
      <div className="flex justify-between">
        <span>{text('Payé', 'تخلّص')}</span>
        <span>{invoice.paid.toFixed(3)} {currency}</span>
      </div>
      <div className="flex justify-between">
        <span>{text('Reste', 'الباقي')}</span>
        <span>{invoice.debt.toFixed(3)} {currency}</span>
      </div>
      <div className="border-t border-dashed border-black my-1"></div>
      <div className="text-center mt-5 text-[10px]">
        {text('Merci de votre visite !', 'يعطيك الصحة على زيارتك!')}<br />
        {text(`À bientôt chez ${storeName}`, `مرحبا بيك ديما عند ${storeName}`)}
      </div>
    </div>
  );
});

PrintableTicket.displayName = 'PrintableTicket';
