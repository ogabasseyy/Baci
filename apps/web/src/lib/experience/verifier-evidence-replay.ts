import type { SupabaseClient } from '@supabase/supabase-js';
import type { VerifierReceipt } from './local-build-supervisor-types';

/** Normal owner RLS read after an uncertain or duplicate receipt write. */
export async function hasExactVerifierEvidence(
  client: SupabaseClient,
  receipt: VerifierReceipt,
  signal?: AbortSignal
) {
  signal?.throwIfAborted();
  const query = client
    .from('experience_evidence')
    .select('id')
    .eq('merchant_id', receipt.merchantId)
    .eq('job_id', receipt.jobId)
    .eq('attempt_nonce', receipt.attemptNonce)
    .eq('build_digest', receipt.buildDigest)
    .eq('receipt_digest', receipt.receiptDigest)
    .eq('host_origin', receipt.hostOrigin);
  const { data, error } = await (signal
    ? query.abortSignal(signal)
    : query
  ).maybeSingle();
  signal?.throwIfAborted();
  return !error && typeof data?.id === 'string';
}
