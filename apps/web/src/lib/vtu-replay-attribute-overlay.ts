import type { SupabaseClient } from '@supabase/supabase-js';
import { formatPhoneNumber, isValidPhoneNumber } from '@/lib/kuda';

/**
 * Replay overlay for mutable VTU attempt attributes (Codex R31 fQGZ,
 * R32 f8Zk/f8Z0).
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
 * fulfillment re-drives; omitted values no-op (stored, then
 * customers.phone for the phone, remain the fallback).
 *
 * Atomicity: the patch runs as a single UPDATE inside
 * `set_vtu_transaction_replay_attributes` (one RPC, no
 * client-side read-modify-write), so concurrent metadata writers
 * (settlement markers, voucher backfill) can never lose keys to a
 * stale snapshot.
 *
 * Bill-identity binding: the route's fingerprint guard runs BEFORE
 * this overlay, so a reference is only ever stored against the
 * same bill identity the key was issued for. Trust parity with
 * attempt 1 (prepare stores a client-supplied reference without
 * re-verifying): no provider round-trip here — one would add a new
 * 5xx surface to the critical retry path.
 *
 * Phone normalize/validate mirrors `preparePendingVtuTransaction`
 * exactly, including the error message, so the route whitelist maps
 * an invalid replay phone to the same 400 as attempt 1.
 */
export async function overlayReplayAttributes(args: {
  supabase: SupabaseClient;
  transactionId: string;
  customerPhone: string | null | undefined;
  validationReference: string | null | undefined;
}): Promise<{ updated: boolean }> {
  const rawPhone = args.customerPhone
    ? formatPhoneNumber(args.customerPhone)
    : '';
  const normalizedPhone = rawPhone || undefined;
  if (normalizedPhone && !isValidPhoneNumber(normalizedPhone)) {
    throw new Error('Invalid customer phone number');
  }
  // Opaque provider token: blank counts as absent, otherwise stored
  // verbatim like attempt 1 (no normalization — see doc above).
  const reference = args.validationReference?.trim()
    ? args.validationReference
    : undefined;
  if (!normalizedPhone && !reference) {
    return { updated: false };
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
  return { updated: true };
}
