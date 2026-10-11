// Lockstep with the server fingerprint
// (`apps/web/src/lib/vtu-wallet-fingerprint.ts`): any field the server
// hashes that is missing here could attach one key to two payloads the
// server considers different (409 loop); any extra field here —
// cosmetic `customerName`/`customerPhone`, `merchantSlug`,
// `customerAddress` — could miss a legitimate retry when hydration or
// a profile update changes it between a timed-out submit and the
// retry (fresh key, double charge).
const SIGNATURE_FIELDS = [
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
  // NOTE: validationReference excluded (ephemeral per-verification
  // artifact — see the server fingerprint note). Lockstep applies.
  'walletAmount',
] as const;

/**
 * Canonical retry signature for a wallet-only VTU payload. Field order
 * is fixed and absent values normalize to null (mirroring the
 * server's `?? null`), so two identical intents always sign
 * identically regardless of key insertion order.
 */
export function buildVtuWalletPayloadSignature(
  payload: Record<string, unknown>
): string {
  const canonical: Record<string, unknown> = {};
  for (const field of SIGNATURE_FIELDS) {
    canonical[field] = payload[field] ?? null;
  }
  return JSON.stringify(canonical);
}
