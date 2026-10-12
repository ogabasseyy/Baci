import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Re-reads the dispatch marker after transport. A data change that landed
 * after the marker reset it via the enqueue trigger, so a reset marker
 * means the just-sent PDF is stale and the worker must retry with fresh
 * data instead of recording a clean sent.
 */
export async function checkManualDocumentDispatchLease(
  supabase: SupabaseClient,
  outboxId: string
): Promise<'held' | 'reset' | 'unknown'> {
  const { data: lease, error: leaseError } = await supabase
    .from('order_notification_outbox')
    .select('dispatch_started_at')
    .match({ id: outboxId })
    .maybeSingle();
  if (leaseError || !lease) return 'unknown';
  return lease.dispatch_started_at ? 'held' : 'reset';
}

export interface DispatchMarkerRow {
  id: string;
  order_id: string;
  merchant_id: string;
  event_type: string;
  claim_owner: string;
}

const MARKER_CLEAR_ATTEMPTS = 3;

/**
 * Clears the dispatch marker with bounded retries. A definite provider
 * rejection must return to the retry path with the marker cleared: the
 * claim RPC requires a null marker, so scheduling a retry with the
 * marker still set skips permanently instead of re-sending. Transient
 * write failures retry here; a conditional mismatch (lost lease) throws
 * immediately since retrying is useless.
 */
export async function clearManualDocumentDispatchMarker(
  supabase: SupabaseClient,
  row: DispatchMarkerRow
): Promise<void> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < MARKER_CLEAR_ATTEMPTS; attempt += 1) {
    if (attempt > 0)
      await new Promise((resolve) =>
        setTimeout(resolve, 100 * 2 ** (attempt - 1))
      );
    const { data: updated, error: updateError } = await supabase
      .from('order_notification_outbox')
      // Bump updated_at like every other outbox writer: the sent
      // transition guards on it as an optimistic version.
      .update({
        dispatch_started_at: null,
        updated_at: new Date().toISOString(),
      })
      .match({
        id: row.id,
        order_id: row.order_id,
        merchant_id: row.merchant_id,
        event_type: row.event_type,
        locked_by: row.claim_owner,
        status: 'processing',
      })
      .select('id')
      .maybeSingle();
    if (!updateError && updated?.id === row.id) return;
    if (!updateError) throw new Error('Manual document dispatch lease lost');
    lastError = updateError;
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('Manual document dispatch lease lost');
}

/**
 * Reclaims a marker stranded by a previous attempt that observed a
 * definite rejection but failed to clear the bookkeeping: nothing was
 * ever accepted, so clearing is safe and required before the claim RPC
 * (which skips on a set marker). Scoped to rows whose last_error proves
 * the prior outcome; a crash after marking keeps any other last_error
 * and still fails closed at the claim. Reclaim failures rethrow the
 * signal error so the worker preserves last_error for the next attempt.
 */
export async function reclaimStaleManualDocumentDispatchMarker(
  supabase: SupabaseClient,
  row: DispatchMarkerRow
): Promise<void> {
  const { data: current, error: readError } = await supabase
    .from('order_notification_outbox')
    .select('dispatch_started_at, last_error')
    .match({ id: row.id, locked_by: row.claim_owner, status: 'processing' })
    .maybeSingle();
  if (readError || !current) throw new Error('dispatch_marker_clear_failed');
  if (
    current.dispatch_started_at == null ||
    current.last_error !== 'dispatch_marker_clear_failed'
  )
    return;
  try {
    await clearManualDocumentDispatchMarker(supabase, row);
  } catch {
    throw new Error('dispatch_marker_clear_failed');
  }
}
