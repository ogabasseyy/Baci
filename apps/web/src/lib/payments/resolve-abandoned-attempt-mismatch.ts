import type { SupabaseClient } from '@supabase/supabase-js';
import type { verifyTransaction } from '@/lib/paystack';
import { fileTerminalAttemptEvidenceMismatch } from './file-terminal-attempt-evidence-mismatch';

type VerifyResult = Awaited<ReturnType<typeof verifyTransaction>>;

/**
 * Resolve a provider/local evidence mismatch on a stale attempt. Terminal
 * provider state (abandoned/failed) is deterministic: file it for
 * operations and stamp the row instead of rotating it through every future
 * sweep. Non-terminal mismatches keep their hold: the provider state may
 * still change. A filing failure also falls back to the hold so the next
 * sweep retries.
 */
export async function resolveAbandonedAttemptMismatch({
  attempt,
  hold,
  mismatchKind,
  result,
  reviewsFiled,
  supabase,
}: {
  attempt: {
    amount: number;
    currency: string;
    gateway_reference: string;
    id: string;
    merchant_id: string;
    metadata: Record<string, unknown> | null;
    order_id: string;
  };
  hold: (reason: string) => Promise<void>;
  mismatchKind: string;
  result: VerifyResult;
  reviewsFiled: string[];
  supabase: SupabaseClient;
}): Promise<void> {
  if (
    result.success &&
    (result.data.status === 'abandoned' || result.data.status === 'failed')
  ) {
    const filed = await fileTerminalAttemptEvidenceMismatch({
      attempt,
      evidence: {
        mismatchDetail: `provider ${result.data.reference} ${result.data.amount} ${result.data.currency}`,
        mismatchKind,
        providerAmount: result.data.amount,
        providerCurrency: result.data.currency,
        providerReference: result.data.reference,
        providerStatus: result.data.status,
      },
      supabase,
    });
    if (filed) {
      reviewsFiled.push(attempt.id);
      return;
    }
  }
  await hold(mismatchKind);
}
