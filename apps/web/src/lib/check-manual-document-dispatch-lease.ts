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
