import React, { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { Repair, StoreSettings } from '../types';
import { useBrand } from './BrandProvider';
import { useTranslation } from 'react-i18next';
import { formatDocumentDate, formatNumber } from '../i18n/format';

interface RepairTicketProps {
  repair: Repair;
  ownerId?: string;
}

export function RepairTicket({ repair, ownerId }: RepairTicketProps) {
  const brand = useBrand();
  const { i18n } = useTranslation();
  const [storeSettings, setStoreSettings] = useState<StoreSettings | null>(null);

  useEffect(() => {
    const finalOwnerId = ownerId || repair.ownerId || 'store';
    const unsubscribe = onSnapshot(
      doc(db, 'settings', finalOwnerId),
      (snapshot) => {
        if (snapshot.exists()) setStoreSettings(snapshot.data() as StoreSettings);
      },
      (error) => console.error('Unable to load repair ticket store settings:', error),
    );

    return () => unsubscribe();
  }, [ownerId, repair.ownerId]);

  const storeName = storeSettings?.storeName || brand.storeName;
  const storeAddress = storeSettings?.address || '';
  const storePhone = storeSettings?.phone || '';
  const currency = storeSettings?.currency || 'DT';
  const documentLanguage = storeSettings?.documentLanguage || 'fr';
  const fixedT = i18n.getFixedT(documentLanguage === 'ar' ? 'ar' : 'fr', 'repairs');
  const arabicT = i18n.getFixedT('ar', 'repairs');
  const label = (key: string) => {
    const french = fixedT(key);
    if (documentLanguage !== 'both') return french;
    return `${french} / ${arabicT(key)}`;
  };
  const formattedDate = (value: any) => {
    try {
      return formatDocumentDate(
        value && typeof value.toDate === 'function' ? value.toDate() : value instanceof Date ? value : value ? new Date(value) : new Date(),
        documentLanguage,
      );
    } catch {
      return formatDocumentDate(new Date(), documentLanguage);
    }
  };

  return (
    <div dir={documentLanguage === 'ar' ? 'rtl' : 'ltr'} lang={documentLanguage === 'ar' ? 'ar' : 'fr'} className={`w-[80mm] mx-auto bg-white text-black font-mono text-[12px] leading-tight p-4 print:p-0 ${documentLanguage === 'ar' ? 'font-arabic' : ''}`}>
      <div className="text-center font-bold text-[16px] uppercase">{storeName}</div>
      <div className="text-center text-[11px]">{storeAddress}</div>
      {storePhone && <div className="text-center text-[11px]">{label('ticket.phone')}: {storePhone}</div>}
      <div className="border-t border-dashed border-black my-2" />
      <div className="text-center font-bold uppercase">{label('ticket.title')}</div>
      <div className="border-t border-dashed border-black my-2" />

      <div>{label('ticket.date')}: {formattedDate(repair.date)}</div>
      <div>{label('ticket.reference')}: {repair.number}</div>
      <div>{label('ticket.client')}: {repair.clientName || '—'}</div>
      {repair.clientPhone && <div>{label('ticket.phone')}: {repair.clientPhone}</div>}
      <div>{label('ticket.device')}: {repair.deviceBrand || ''} {repair.deviceModel || ''}</div>
      {repair.imei && <div>IMEI: {repair.imei}</div>}
      {repair.deviceCondition && <div>{label('ticket.condition')}: {repair.deviceCondition}</div>}
      {repair.accessories && <div>{label('ticket.accessories')}: {repair.accessories}</div>}

      <div className="border-t border-dashed border-black my-2" />
      <div className="font-bold">{label('ticket.problem')}:</div>
      <div>{repair.problem || '—'}</div>

      {repair.diagnostic && (
        <>
          <div className="font-bold mt-2">{label('ticket.diagnosis')}:</div>
          <div>{repair.diagnostic}</div>
        </>
      )}

      {repair.parts && repair.parts.length > 0 && (
        <>
          <div className="border-t border-dashed border-black my-2" />
          <div className="font-bold">{label('ticket.parts')}</div>
          {repair.parts.map((part, index) => (
            <div key={`${part.productId}-${index}`} className="flex justify-between gap-2">
              <span>{part.name} x {part.quantity}</span>
              <span>{formatNumber(part.total, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currency}</span>
            </div>
          ))}
        </>
      )}

      <div className="border-t border-dashed border-black my-2" />
      <div className="flex justify-between font-bold">
        <span>{label('ticket.total')}</span>
        <span>{formatNumber(Number(repair.total || 0), { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currency}</span>
      </div>
      <div className="flex justify-between">
        <span>{label('ticket.paid')}</span>
        <span>{formatNumber(Number(repair.paid || 0), { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currency}</span>
      </div>
      <div className="flex justify-between">
        <span>{label('ticket.remaining')}</span>
        <span>{formatNumber(Number(repair.debt || 0), { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currency}</span>
      </div>
      {repair.discount && repair.discount > 0 && (
        <div className="flex justify-between">
          <span>{label('ticket.discount')}</span>
          <span>{formatNumber(Number(repair.discount), { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currency}</span>
        </div>
      )}

      <div className="border-t border-dashed border-black my-2" />
      <div className="text-center mt-4 text-[10px]">
        {label('ticket.thanks')}<br />
        {storeName}
      </div>
    </div>
  );
}

export default RepairTicket;
