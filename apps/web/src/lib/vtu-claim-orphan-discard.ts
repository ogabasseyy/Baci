import type { SupabaseClient } from '@supabase/supabase-js';
import { cleanupOrphanVtuTransactionAfterKeyRace } from './vtu-orphan-transaction-cleanup';

/**
 * Route-facing orphan discard for intent-claim paths (join loser +
 * certain-abort rejections): runs the guarded cleanup and logs an
 * unresolved outcome with its path context. Always resolves — the
 * cleanup outcome never masks the claim response (Muse R55 HIGH).
 */
export async function discardOrphanedClaimTransaction({
  context,
  merchantId,
  supabase,
  transactionId,
}: {
  context: 'join' | 'rejection';
  merchantId: string;
  supabase: SupabaseClient;
  transactionId: string;
}): Promise<void> {
  const outcome = await cleanupOrphanVtuTransactionAfterKeyRace({
    merchantId,
    supabase,
    transactionId,
  });
  if (outcome === 'unresolved') {
    console.error(
      `Orphan VTU cleanup unresolved after intent-claim ${context}; row may strand pending:`,
      { transactionId }
    );
  }
}
