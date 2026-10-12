import type { SupabaseClient } from '@supabase/supabase-js';

/** Minimal row shape the restore needs (structural; no import cycle). */
export interface PreVendRestoreRow {
  id: string;
  metadata?: Record<string, unknown> | null;
}

/**
 * Best-effort restore for pre-vend interruptions (debit RPC error,
 * walletDebited metadata write failure): flips the claimed row back
 * to pending with a resume marker so client retry AND the cron
 * re-drive it (claim → debit, idempotent → vend). Without this the
 * row sits processing with no provider reference, which the
 * reconciliation claim declines — debited with no vend or refund,
 * forever. Failures of THIS write only log: the caller still throws
 * the original error. Extracted from vtu-fulfillment.ts per the Boy
 * Scout Rule (that module is over the 300-line budget).
 */
export async function restoreInterruptedPreVendVtuRow({
  errorMessage,
  row,
  supabase,
}: {
  errorMessage: string;
  row: PreVendRestoreRow;
  supabase: SupabaseClient;
}): Promise<void> {
  const { error } = await supabase
    .from('vtu_transactions')
    .update({
      error_message: errorMessage,
      metadata: {
        ...(row.metadata ?? {}),
        preVendInterruptedAt: new Date().toISOString(),
      },
      status: 'pending',
    })
    .eq('id', row.id)
    .eq('status', 'processing');
  if (error) {
    console.error('Failed to restore interrupted pre-vend VTU row:', {
      error: error.message,
      transactionId: row.id,
    });
  }
}
