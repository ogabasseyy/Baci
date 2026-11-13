/**
 * What a customer sees for a wallet transaction. Ledger descriptions are
 * written for operations and can name the provider behind a payment or check
 * ("Petrock IMEI lookup payment: <uuid>", "… via paystack"); customers never
 * see provider names or internal ids. Known kinds get a fixed label; any
 * other description has provider names, "via <provider>" and ids removed.
 */
const LABEL_BY_SOURCE: Readonly<Record<string, string>> = {
  imei_wallet_payment: 'IMEI check',
  imei_wallet_refund: 'IMEI check refund',
};

// Back-office providers (payments, checks, delivery, bills) that never belong
// in customer-facing text. Networks and billers the customer chose (MTN,
// Ikeja Electric) are not providers and stay.
const PROVIDERS =
  'petrock|paystack|monnify|korapay|flutterwave|kuda|credit direct|shiip|topship|gigl|gig logistics|vtpass|redvault|sickw|dhru|imeicheck';
// "via Paystack", "from Kuda": the joining word goes with the provider.
const JOINED_PROVIDER = new RegExp(
  `\\s*\\b(?:via|by|through|from|with)\\s+(?:${PROVIDERS})\\b`,
  'gi'
);
const PROVIDER = new RegExp(`\\b(?:${PROVIDERS})\\b`, 'gi');
// A provider we don't know yet, named in a trailing "via Acmepay".
const TRAILING_VIA_ONE_WORD = /\s+\b(?:via|by|through)\s+[A-Za-z][\w.-]*\s*$/i;
// Internal ids: UUIDs, shortened hex ("3f2b…"), long mixed hex tokens, and
// long digit runs such as an IMEI or provider reference (never an amount).
const IDS = [
  /:?\s*\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
  /:?\s*\b(?=[0-9a-f]*\d)[0-9a-f]{3,}(?:…|\.{3})/gi,
  /\b(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{8,}\b/gi,
  /(?<![₦\d,.])\b\d{10,}\b/g,
];

export function customerWalletTransactionLabel(input: {
  description: string | null | undefined;
  sourceType?: string | null;
}): string {
  const fixed = input.sourceType
    ? LABEL_BY_SOURCE[input.sourceType]
    : undefined;
  if (fixed) return fixed;
  let cleaned = (input.description ?? '')
    .replace(JOINED_PROVIDER, '')
    .replace(PROVIDER, '');
  for (const id of IDS) cleaned = cleaned.replace(id, '');
  cleaned = cleaned
    .replace(TRAILING_VIA_ONE_WORD, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s:–-]+|[\s:–-]+$/g, '')
    .trim();
  if (!cleaned) return 'Transaction';
  // Untouched text is returned as written; only a cleaned label is re-capitalised.
  const original = (input.description ?? '').trim();
  if (cleaned === original) return original;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}
