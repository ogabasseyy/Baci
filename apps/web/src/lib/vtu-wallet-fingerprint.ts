import { createHash } from 'node:crypto';
import type { VtuWalletOnlyChargeInput } from '@/schemas/vtu-wallet-only';

/**
 * Canonical fingerprint of the wallet-only request payload. Used by
 * the wallet-only route to detect a key being reused with a CHANGED
 * payload (e.g. the user edited the form between a timed-out attempt
 * and the retry). Only the recipient / intent fields are hashed —
 * cosmetic fields like `customerName` and `customerPhone` are
 * excluded so a normalized name doesn't false-positive a legitimate
 * retry.
 *
 * The order of keys in the canonical object is fixed via an explicit
 * replacer array so the hash is stable across Node versions and
 * unrelated to property insertion order.
 */
const FINGERPRINT_FIELDS = [
  'amount',
  'billItemIdentifier',
  'billerCode',
  'billerName',
  'customerIdentifier',
  'dataPlanCode',
  'networkProvider',
  'phoneNumber',
  'productCode',
  'provider',
  'requireValidationRef',
  'type',
  // NOTE: validationReference is deliberately excluded — it is an
  // ephemeral per-verification artifact (re-verifying the same meter
  // can issue a new one). Hashing it would split a retry across
  // re-verification into a fresh key and a second debit.
  // `customerAddress` is excluded for the same reason: receipt-only
  // metadata (history + emailed receipts), never a vend input.
  // Accepted residual: a replayed attempt keeps the earlier address.
  'walletAmount',
] as const;

export function computeVtuWalletRequestFingerprint(
  parsed: VtuWalletOnlyChargeInput
): string {
  const canonical: Record<string, unknown> = {};
  for (const field of FINGERPRINT_FIELDS) {
    canonical[field] = parsed[field as keyof VtuWalletOnlyChargeInput] ?? null;
  }
  return createHash('sha256')
    .update(JSON.stringify(canonical, [...FINGERPRINT_FIELDS]))
    .digest('hex');
}
