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
 * retries — and the provider contact phone reaches retries via the
 * server-side current-attempt overlay, not the key). `expectedUserId`
 * is a binding, never identity.
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
 * to null, string values normalize per-field (below). Each side
 * serializes the projection its own way (server hashes, clients
 * stringify) — cross-side equality is never required, only
 * same-field-set lockstep.
 *
 * Normalization is a double-spend guard, not cosmetics. The
 * descriptor is the ONLY dedupe across an ambiguous timeout (the
 * server has no fingerprint-dedupe: a fresh key always mints a fresh
 * debit), so cosmetic variants of the same logical purchase MUST
 * canonicalize identically — or a reformat between attempts (new
 * descriptor → fresh key) debits and vends twice:
 * - phoneNumber: Kuda digit-strip + 234→0 + leading-0 (mirrors web
 *   `formatPhoneNumber`; this package cannot import web code).
 * - networkProvider: trim + upper + legacy alias map (mirrors web
 *   `normalizeVtuNetworkProvider`, including T2 → 9MOBILE).
 * - every other string field: trim (surrounding whitespace is never
 *   a distinct vend target). Non-strings pass through untouched.
 */
const LEGACY_NETWORK_PROVIDER_ALIASES: Record<string, string> = {
  // Mirror of web normalize-vtu-network-provider.ts (Etisalat/T2 label).
  T2: '9MOBILE',
};

function normalizeIdentityPhoneNumber(value: string): string {
  let cleaned = value.replace(/\D/g, '');
  if (cleaned.startsWith('234')) {
    cleaned = `0${cleaned.substring(3)}`;
  }
  if (!cleaned.startsWith('0') && cleaned.length === 10) {
    cleaned = `0${cleaned}`;
  }
  return cleaned;
}

function normalizeIdentityNetworkProvider(value: string): string {
  const upper = value.trim().toUpperCase();
  return LEGACY_NETWORK_PROVIDER_ALIASES[upper] ?? upper;
}

function normalizeIdentityValue(
  field: VtuRetryIdentityField,
  value: unknown
): unknown {
  if (typeof value !== 'string') {
    return value ?? null;
  }
  if (field === 'phoneNumber') {
    return normalizeIdentityPhoneNumber(value);
  }
  if (field === 'networkProvider') {
    return normalizeIdentityNetworkProvider(value);
  }
  return value.trim();
}

export function canonicalizeVtuRetryIdentity(
  payload: Record<string, unknown>
): Record<string, unknown> {
  const canonical: Record<string, unknown> = {};
  for (const field of VTU_RETRY_IDENTITY_FIELDS) {
    canonical[field] = normalizeIdentityValue(field, payload[field]);
  }
  return canonical;
}
