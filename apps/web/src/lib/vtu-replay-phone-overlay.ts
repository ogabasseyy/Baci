import type { SupabaseClient } from '@supabase/supabase-js';
import { formatPhoneNumber, isValidPhoneNumber } from '@/lib/kuda';

/**
 * Replay overlay for the provider contact phone (Codex R31 fQGZ).
 *
 * `metadata.customerPhone` feeds Monnify/Kuda bill calls, but the
 * replay path re-drives fulfillment from the attempt-1 snapshot, so
 * a correction (or a profile phone that hydrated after attempt 1 —
 * web sends `customer?.phone`, nullable) never reached the provider.
 * The phone is deliberately NOT part of the retry identity —
 * binding it would 409 corrections into fresh keys and fresh debits
 * (see the shared identity exclusion note) — so the retry-safe
 * binding is a current-attempt overlay instead:
 *
 *   - request carries a valid phone that differs from stored → merge
 *     it into metadata before fulfillment re-drives;
 *   - request omits it (mobile sends none) or matches stored →
 *     no-op; fulfillment falls back to stored, then customers.phone.
 *
 * Normalize/validate mirrors `preparePendingVtuTransaction` exactly,
 * including the error message, so the route whitelist maps an
 * invalid replay phone to the same 400 as attempt 1.
 */
export async function overlayReplayCustomerPhone(args: {
  supabase: SupabaseClient;
  transactionId: string;
  customerPhone: string | null | undefined;
}): Promise<{ updated: boolean }> {
  const raw = args.customerPhone ? formatPhoneNumber(args.customerPhone) : '';
  const normalized = raw || undefined;
  if (!normalized) {
    return { updated: false };
  }
  if (!isValidPhoneNumber(normalized)) {
    throw new Error('Invalid customer phone number');
  }
  const { data, error } = await args.supabase
    .from('vtu_transactions')
    .select('metadata')
    .eq('id', args.transactionId)
    .single();
  if (error) {
    throw new Error(
      `Failed to load VTU transaction metadata: ${error.message}`
    );
  }
  const stored: unknown = data?.metadata;
  const metadata: Record<string, unknown> =
    typeof stored === 'object' && stored !== null
      ? (stored as Record<string, unknown>)
      : {};
  if (metadata.customerPhone === normalized) {
    return { updated: false };
  }
  const { error: updateError } = await args.supabase
    .from('vtu_transactions')
    .update({ metadata: { ...metadata, customerPhone: normalized } })
    .eq('id', args.transactionId);
  if (updateError) {
    throw new Error(
      `Failed to overlay replay customer phone: ${updateError.message}`
    );
  }
  return { updated: true };
}
