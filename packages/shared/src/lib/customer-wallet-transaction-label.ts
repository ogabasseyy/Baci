import { stripProviderNames } from './strip-provider-names';

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
  // Stored as "PiggyVest bank transfer" / "PiggyVest card funding".
  piggyvest_primary_inflow: 'Money added',
  piggyvest_primary_card_custody: 'Card top-up',
};

// Internal ids: UUIDs, shortened hex ("3f2b…"), long mixed hex tokens, and
// long digit runs such as an IMEI or provider reference (never an amount or
// the customer's own phone number).
const IDS = [
  /:?\s*\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
  /:?\s*\b(?=[0-9a-f]*\d)[0-9a-f]{3,}(?:…|\.{3})/gi,
  /\b(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{8,}\b/gi,
  // 15+ digits: an IMEI or long provider reference. A phone number, even with
  // +234 (13 digits), stays.
  /(?<![₦\d,.])\b\d{15,}\b/g,
];

export function customerWalletTransactionLabel(input: {
  description: string | null | undefined;
  sourceType?: string | null;
}): string {
  const fixed = input.sourceType
    ? LABEL_BY_SOURCE[input.sourceType]
    : undefined;
  if (fixed) return fixed;
  let cleaned = stripProviderNames(input.description ?? '');
  for (const id of IDS) cleaned = cleaned.replace(id, '');
  cleaned = cleaned
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s:–-]+|[\s:–-]+$/g, '')
    .trim();
  if (!cleaned) return 'Transaction';
  // Untouched text is returned as written; only a cleaned label is re-capitalised.
  const original = (input.description ?? '').trim();
  if (cleaned === original) return original;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}
