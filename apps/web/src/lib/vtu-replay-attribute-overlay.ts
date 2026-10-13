import type { SupabaseClient } from '@supabase/supabase-js';
import { formatPhoneNumber, isValidPhoneNumber } from '@/lib/kuda';
import { verifyBillCustomer } from '@/lib/monnify-bills';

/**
 * Replay overlay for mutable VTU attempt attributes (Codex R31 fQGZ,
 * R32 f8Zk/f8Z0, R33 gtRN, R37 rktSo, R42 rm5aj).
 *
 * The patch RPC applies only while the row is pending: a replay
 * racing in-flight fulfillment must not bump updated_at (that would
 * invalidate the original request's post-claim compare-and-set
 * token). Non-pending rows silently skip — they never consume
 * overlaid attributes anyway.
 *
 * `metadata.customerPhone` feeds Monnify/Kuda bill calls and
 * `metadata.validationReference` is sent back on Monnify re-drives,
 * but the replay path re-drives fulfillment from stored state, so a
 * corrected phone, a profile phone that hydrated after attempt 1
 * (web sends `customer?.phone`, nullable), or a refreshed reference
 * (re-verification issues a new one; the attempt-1 reference expires)
 * never reached the provider. Both fields are deliberately NOT part
 * of the retry identity — binding them would 409 corrections into
 * fresh keys and fresh debits (see the shared identity exclusion
 * note) — so the retry-safe binding is a current-attempt overlay:
 * when the replaying request carries a value, merge it before
 * fulfillment re-drives; omitted phones no-op (stored, then
 * customers.phone, remain the fallback).
 *
 * Omitted REFERENCES are server-refreshed instead of left stale:
 * neither airtime client sends `validationReference` (airtime refs
 * are minted server-side by `resolveMonnifyAirtimeCheckoutFields`),
 * so without a refresh the replay and reconciliation re-drives
 * reuse the attempt-1 reference forever. A request-supplied
 * reference always wins over the refresh. Refresh is best-effort:
 * any failure falls back to the stored reference (today's
 * behavior), so the refresh can only help, never add a failure
 * mode to the retry path.
 *
 * Atomicity: the patch runs as a single UPDATE inside
 * `set_vtu_transaction_replay_attributes` (one RPC, no
 * client-side read-modify-write), so concurrent metadata writers
 * (settlement markers, voucher backfill) can never lose keys to a
 * stale snapshot.
 *
 * Bill-identity binding: the route's fingerprint guard runs BEFORE
 * this overlay, and the refresh re-verifies the ROW's own
 * biller/product/customer — so a reference is only ever stored
 * against the same bill identity the key was issued for.
 *
 * Phone normalize mirrors `preparePendingVtuTransaction`, but an
 * invalid replay phone is IGNORED (never thrown): the row already
 * carries attempt-1-validated state, and throwing would 400 the
 * replay of an EXISTING transaction — rotating the clients' retained
 * key so the corrected retry mints fresh and debits twice. The
 * invalid value degrades to omitted (stored, then customers.phone,
 * win); attempt-1 validation still rejects invalid phones.
 */
export async function overlayReplayAttributes(args: {
  supabase: SupabaseClient;
  transactionId: string;
  customerPhone: string | null | undefined;
  validationReference: string | null | undefined;
}): Promise<{ updated: boolean; refreshed: boolean }> {
  const rawPhone = args.customerPhone
    ? formatPhoneNumber(args.customerPhone)
    : '';
  let normalizedPhone = rawPhone || undefined;
  if (normalizedPhone && !isValidPhoneNumber(normalizedPhone)) {
    // Invalid replay phone ≡ omitted phone (see doc above): the
    // incoming value is only a freshening candidate for a row that
    // already exists, so degrade instead of 400ing the replay. Warn
    // with the transaction id only (no phone value — PII).
    console.warn('VTU replay ignoring invalid customer phone:', {
      transactionId: args.transactionId,
    });
    normalizedPhone = undefined;
  }
  // Opaque provider token: blank counts as absent, otherwise stored
  // verbatim like attempt 1 (no normalization — see doc above).
  const requestReference = args.validationReference?.trim()
    ? args.validationReference
    : undefined;
  // A request-supplied reference always wins; otherwise try a
  // server refresh (airtime clients never send one).
  const refreshedReference = requestReference
    ? undefined
    : await tryRefreshServerValidationReference(
        args.supabase,
        args.transactionId
      );
  const reference = requestReference ?? refreshedReference;
  if (!normalizedPhone && !reference) {
    return { updated: false, refreshed: false };
  }
  const { error } = await args.supabase.rpc(
    'set_vtu_transaction_replay_attributes',
    {
      p_transaction_id: args.transactionId,
      p_customer_phone: normalizedPhone ?? null,
      p_validation_reference: reference ?? null,
    }
  );
  if (error) {
    throw new Error(`Failed to overlay replay attributes: ${error.message}`);
  }
  return { updated: true, refreshed: refreshedReference !== undefined };
}

/**
 * Best-effort server refresh of a Monnify validation reference. Never
 * throws: any failure (missing row, select error, unverified
 * customer, provider exception) returns undefined so the caller
 * falls back to the stored reference. Only warns on actual
 * failures — non-Monnify rows and ref-less rows are normal skips.
 */
async function tryRefreshServerValidationReference(
  supabase: SupabaseClient,
  transactionId: string
): Promise<string | undefined> {
  try {
    // Ownership-scoped scalar projection (Codex R50 6rp7ND,
    // narrowed by Muse R52): the RPC returns only the refresh
    // scalars for owner rows (zero rows otherwise — no existence
    // oracle) instead of the whole metadata jsonb.
    const { data, error } = await supabase
      .rpc('get_vtu_replay_refresh_fields', {
        p_transaction_id: transactionId,
      })
      .maybeSingle();
    // Untyped client: the RPC projection is unknown to the query
    // builder, so narrow the refresh scalars explicitly.
    const refresh = data as {
      biller_code: unknown;
      customer_identifier: unknown;
      product_code: unknown;
      provider: unknown;
      require_validation_ref: unknown;
      status: unknown;
    } | null;
    if (error || !refresh) {
      return undefined;
    }
    // Refresh only before a re-vend: successful rows short-circuit in
    // fulfillment, processing rows requery by provider reference, and
    // failed rows take the refund path — none consume a reference, so
    // a 30s validation call here would only stall lost-response
    // replays during a validation outage (Codex R34 hY3x).
    if (refresh.status !== 'pending') {
      return undefined;
    }
    if (
      refresh.provider !== 'monnify' ||
      refresh.require_validation_ref !== true
    ) {
      return undefined;
    }
    const billerCode =
      typeof refresh.biller_code === 'string' ? refresh.biller_code : '';
    const productCode =
      typeof refresh.product_code === 'string' ? refresh.product_code : '';
    const customerIdentifier =
      typeof refresh.customer_identifier === 'string'
        ? refresh.customer_identifier
        : '';
    if (!billerCode || !productCode || !customerIdentifier) {
      return undefined;
    }
    const verification = await verifyBillCustomer(
      billerCode,
      productCode,
      customerIdentifier
    );
    if (!verification.verified || !verification.validationReference) {
      console.warn(
        'VTU replay reference refresh failed; reusing stored reference:',
        { transactionId, message: verification.message }
      );
      return undefined;
    }
    return verification.validationReference;
  } catch (error) {
    console.warn(
      'VTU replay reference refresh errored; reusing stored reference:',
      {
        transactionId,
        message: error instanceof Error ? error.message : String(error),
      }
    );
    return undefined;
  }
}
