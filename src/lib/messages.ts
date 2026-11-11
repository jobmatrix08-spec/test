export type MessageTemplateKey =
  | 'appareil_recu'
  | 'en_attente_piece'
  | 'repare_pret'
  | 'rappel_paiement';

export type MessageTemplateSet = Record<MessageTemplateKey, string>;
export type MessageChannel = 'WhatsApp' | 'SMS';

export const MESSAGE_TEMPLATE_KEYS: MessageTemplateKey[] = [
  'appareil_recu',
  'en_attente_piece',
  'repare_pret',
  'rappel_paiement',
];

export function normalizeMessagePhone(value: string, countryCode = '216'): string {
  const raw = value.trim();
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  let normalized = digits;
  if (raw.startsWith('+')) normalized = digits;
  else if (raw.startsWith('00')) normalized = digits.slice(2);
  else {
    const prefix = countryCode.replace(/\D/g, '') || '216';
    normalized = digits.startsWith(prefix) && digits.length >= prefix.length + 7
      ? digits
      : `${prefix}${digits.replace(/^0/, '')}`;
  }

  return /^[1-9]\d{6,14}$/.test(normalized) ? normalized : '';
}

export function renderMessageTemplate(
  template: string,
  values: {
    client: string;
    appareil: string;
    numero: string;
    montant_restant: string;
    nom_magasin: string;
  },
): string {
  return template.replace(/\{(client|appareil|numero|montant_restant|nom_magasin)\}/g, (_match, key: keyof typeof values) =>
    values[key],
  );
}

export function buildMessageUrl(channel: MessageChannel, phone: string, message: string): string {
  const body = encodeURIComponent(message);
  return channel === 'WhatsApp'
    ? `https://wa.me/${phone}?text=${body}`
    : `sms:${phone}?body=${body}`;
}
