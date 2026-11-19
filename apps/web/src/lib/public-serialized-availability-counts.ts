import type { SupabaseClient } from '@supabase/supabase-js';

function isTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const { message, details } = error as Record<string, unknown>;
  return [message, details].some(
    (value) => typeof value === 'string' && value.includes('TimeoutError')
  );
}

/** Fetches counts with one intentional timeout retry and no SDK retry storm. */
export async function fetchPublicSerializedAvailabilityCounts(
  supabase: SupabaseClient,
  merchantId: string,
  productIds: string[],
  branchId?: string,
  signal?: AbortSignal
): Promise<unknown> {
  const fetchCounts = () => {
    const rpc = supabase.rpc(
      'get_public_serialized_variant_availability_counts',
      {
        p_merchant_id: merchantId,
        p_product_ids: productIds,
        p_branch_id: branchId || null,
      }
    );
    const query = (signal ? rpc.abortSignal(signal) : rpc).overrideTypes<
      unknown,
      { merge: false }
    >();
    return typeof query.retry === 'function' ? query.retry(false) : query;
  };

  let { data, error } = await fetchCounts();
  if (!signal?.aborted && isTimeoutError(error)) {
    ({ data, error } = await fetchCounts());
  }
  if (error) {
    throw error;
  }
  return data;
}
