/**
 * Canonical VTU retry-identity field list. The server fingerprint
 * (`apps/web/src/lib/vtu-wallet-fingerprint.ts`) and both client
 * descriptors (web `utility-vtu-payload-signature.ts`, mobile
 * `pending-vtu-idempotency.ts`) MUST use exactly these fields: a
 * field the server hashes that a client omits attaches one key to
 * two payloads the server considers different (409 loop); a field
 * a client signs that the server ignores splits a retry across a
 * cosmetic change into a fresh key and a second debit. Single
 * source of truth so a future payload-field change cannot land on
 * only one side.
 *
 * Deliberately excluded (same reason everywhere): ephemeral
 * `validationReference` (re-verification issues a new one) and
 * receipt-only `customerAddress`/`customerName`/`customerPhone`/
 * `merchantSlug` (hydration drift between attempts must not split
 * retries). `expectedUserId` is a binding, never identity.
 */
export const VTU_RETRY_IDENTITY_FIELDS = [
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
  'walletAmount',
] as const;

export type VtuRetryIdentityField = (typeof VTU_RETRY_IDENTITY_FIELDS)[number];

/**
 * Canonical projection: fixed field order, absent values normalize
 * to null. Each side serializes the projection its own way (server
 * hashes, clients stringify) — cross-side equality is never
 * required, only same-field-set lockstep.
 */
export function canonicalizeVtuRetryIdentity(
  payload: Record<string, unknown>
): Record<string, unknown> {
  const canonical: Record<string, unknown> = {};
  for (const field of VTU_RETRY_IDENTITY_FIELDS) {
    canonical[field] = payload[field] ?? null;
  }
  return canonical;
}
