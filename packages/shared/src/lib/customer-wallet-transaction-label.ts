import {
  IDS,
  LABEL_BY_SOURCE,
} from './customer-wallet-transaction-label.constants';
import { stripProviderNames } from './strip-provider-names';

/**
 * What a customer sees for a wallet transaction. Ledger descriptions are
 * written for operations and can name the provider behind a payment or check
 * ("Petrock IMEI lookup payment: <uuid>", "… via paystack"); customers never
 * see provider names or internal ids. Known kinds get a fixed label; any
 * other description has provider names, "via <provider>" and ids removed.
 */
export function customerWalletTransactionLabel(input: {
  description: string | null | undefined;
  sourceType?: string | null;
}): string {
  const fixed = input.sourceType
    ? LABEL_BY_SOURCE.get(input.sourceType)
    : undefined;
  if (fixed) return fixed;
  let cleaned = stripProviderNames(input.description ?? '');
  for (const id of IDS) cleaned = cleaned.replace(id, '');
  cleaned = cleaned
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;])/g, '$1')
    .replace(/^[\s:–—|.,;-]+|[\s:–—|.,;-]+$/g, '')
    .trim();
  if (!cleaned) return 'Transaction';
  // Untouched text is returned as written; only a cleaned label is re-capitalised.
  const original = (input.description ?? '').trim();
  if (cleaned === original) return original;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}
