import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  StorefrontDatabase,
  StorefrontMerchantSnapshotRow,
} from '@/types/storefront-database';
import {
  resolveStorefrontReadResult,
  type StorefrontReadResult,
} from './storefront-read-result';

// Keep the per-RPC deadline aligned with the 10-second runtime transport
// deadline in createStorefrontPublicReadFetch(). A shorter abort here turns
// slow-but-valid Supabase responses into storefront Server Component errors
// before the public client reaches its own bounded transport limit.
const MERCHANT_SNAPSHOT_RUNTIME_DEADLINE_MS = 10_000;

function merchantSnapshotDeadlineMs() {
  return MERCHANT_SNAPSHOT_RUNTIME_DEADLINE_MS;
}

function isBoundedStorefrontBuild() {
  return process.env.BACI_STOREFRONT_BUILD_READS === 'bounded';
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isRuntimeDeadlineAbort(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const name = Reflect.get(error, 'name');
  return name === 'AbortError' || name === 'TimeoutError';
}

export async function readStorefrontMerchantSnapshot(
  client: SupabaseClient<StorefrontDatabase>,
  identifier: string
): Promise<StorefrontReadResult<StorefrontMerchantSnapshotRow>> {
  const query = client.rpc(
    'resolve_storefront_public_snapshot_v2',
    { p_identifier: identifier },
    { get: true }
  );
  const boundedQuery =
    typeof query.abortSignal === 'function'
      ? (isBoundedStorefrontBuild()
          ? query
          : query.abortSignal(AbortSignal.timeout(merchantSnapshotDeadlineMs()))
        )
          // Disable postgrest-js's automatic GET retry so the runtime deadline
          // or admitted build transport deadline is not extended by backoff.
          // Pinned by supabase/postgrest-timeout-retry.test.ts.
          .retry(false)
      : query;
  let response: Awaited<typeof boundedQuery>;
  try {
    response = await boundedQuery;
  } catch (error) {
    if (!isRuntimeDeadlineAbort(error)) throw error;

    const rejectedResult = resolveStorefrontReadResult({
      operation: 'merchant_snapshot',
      response: { data: null, error },
      parse: (rows) => (Array.isArray(rows) ? (rows[0] ?? null) : null),
    });
    if (rejectedResult.status !== 'unavailable') throw error;
    return rejectedResult;
  }

  const result = resolveStorefrontReadResult({
    operation: 'merchant_snapshot',
    response,
    parse: (rows) => (Array.isArray(rows) ? (rows[0] ?? null) : null),
  });

  if (result.status === 'unavailable') return result;
  if (result.status === 'not_found') {
    return {
      status: 'unavailable',
      error: {
        kind: 'integrity',
        operation: 'merchant_snapshot',
        retryable: false,
      },
    };
  }

  const row = result.value;
  if (row.resolution_status === 'not_found') {
    return { status: 'not_found' };
  }
  if (row.resolution_status !== 'found' || !isJsonObject(row.merchant_data)) {
    return {
      status: 'unavailable',
      error: {
        kind: 'integrity',
        operation: 'merchant_snapshot',
        retryable: false,
      },
    };
  }

  return result;
}
