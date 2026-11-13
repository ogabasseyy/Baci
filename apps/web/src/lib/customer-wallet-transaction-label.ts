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
  'petrock|paystack|monnify|korapay|flutterwave|topship|gigl|gig logistics|vtpass|redvault|sickw|dhru|imeicheck';
const VIA_PROVIDER = new RegExp(
  `\\s*\\b(?:via|by|through)\\s+(?:${PROVIDERS})\\b`,
  'gi'
);
const PROVIDER = new RegExp(`\\b(?:${PROVIDERS})\\b`, 'gi');
const UUID =
  /:?\s*\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

export function customerWalletTransactionLabel(input: {
  description: string | null | undefined;
  sourceType?: string | null;
}): string {
  const fixed = input.sourceType
    ? LABEL_BY_SOURCE[input.sourceType]
    : undefined;
  if (fixed) return fixed;
  const cleaned = (input.description ?? '')
    .replace(VIA_PROVIDER, '')
    .replace(PROVIDER, '')
    .replace(UUID, '')
    .replace(/\s+-\s+(?=\S)/g, ' – ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s:–-]+|[\s:–-]+$/g, '')
    .trim();
  if (!cleaned) return 'Transaction';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}
