import type { SupabaseClient } from '@supabase/supabase-js';
import type { StorefrontDatabase } from '@/types/storefront-database';
import type { Json } from '@/types/supabase';
import {
  resolveStorefrontReadResult,
  type StorefrontReadResult,
} from './storefront-read-result';

const PDP_CORE_SNAPSHOT_RUNTIME_DEADLINE_MS = 8_000;

function pdpCoreSnapshotDeadlineMs() {
  return PDP_CORE_SNAPSHOT_RUNTIME_DEADLINE_MS;
}

function isBoundedStorefrontBuild() {
  return process.env.BACI_STOREFRONT_BUILD_READS === 'bounded';
}

function isRuntimeDeadlineAbort(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const name = Reflect.get(error, 'name');
  return name === 'AbortError' || name === 'TimeoutError';
}

function isJsonObject(value: Json | null): value is Record<string, Json> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export type StorefrontPdpCoreSnapshot =
  | { kind: 'product'; product: Record<string, Json> }
  | { kind: 'redirect'; target: Record<string, Json> };

export async function readStorefrontPdpCoreSnapshot(
  client: SupabaseClient<StorefrontDatabase>,
  {
    branchId = null,
    merchantId,
    productSlug,
  }: {
    branchId?: string | null;
    merchantId: string;
    productSlug: string;
  }
): Promise<StorefrontReadResult<StorefrontPdpCoreSnapshot>> {
  // p_branch_id is OMITTED (never passed as null) when no branch is selected:
  // postgrest-js GET-mode serializes every non-undefined arg via `${value}`,
  // so `p_branch_id: null` becomes the literal query string `p_branch_id=null`
  // and PostgREST rejects it with 22P02 ('invalid input syntax for type uuid:
  // "null"') — every read then deterministically classified 'unavailable'
  // (verified against the live RPC on 2026-07-11; it broke all build-time PDP
  // prerenders). Omitting the key applies the RPC's SQL default (null).
  const boundedBuild = isBoundedStorefrontBuild();
  // Keep one deadline across the initial attempt and the explicitly bounded
  // retry. A transient pool response can recover without extending the route's
  // existing eight-second runtime budget.
  const runtimeDeadline = boundedBuild
    ? undefined
    : AbortSignal.timeout(pdpCoreSnapshotDeadlineMs());
  const createBoundedQuery = () => {
    const query = client.rpc(
      'get_storefront_pdp_core_v2',
      {
        p_merchant_id: merchantId,
        p_product_slug: productSlug,
        ...(branchId == null ? {} : { p_branch_id: branchId }),
      },
      { get: true }
    );
    if (typeof query.abortSignal !== 'function') return query;

    const boundedQuery = runtimeDeadline
      ? query.abortSignal(runtimeDeadline)
      : query;
    // Disable postgrest-js's automatic GET retry so the runtime deadline
    // or admitted build transport deadline is not extended by backoff.
    // Pinned by supabase/postgrest-timeout-retry.test.ts.
    return boundedQuery.retry(false);
  };

  const readResponse = async () => {
    try {
      return await createBoundedQuery();
    } catch (error) {
      if (!runtimeDeadline?.aborted || !isRuntimeDeadlineAbort(error)) {
        throw error;
      }
      return { data: null, error };
    }
  };

  const parse = (rows: unknown) =>
    Array.isArray(rows) ? (rows[0] ?? null) : null;
  let result = resolveStorefrontReadResult({
    operation: 'pdp_core_snapshot',
    response: await readResponse(),
    parse,
  });

  // Retry exactly once for failures already classified as transient. The
  // shared deadline prevents a retry from extending runtime requests, while
  // stable database/integrity failures remain terminal.
  if (
    result.status === 'unavailable' &&
    result.error.retryable &&
    runtimeDeadline &&
    !runtimeDeadline.aborted
  ) {
    result = resolveStorefrontReadResult({
      operation: 'pdp_core_snapshot',
      response: await readResponse(),
      parse,
    });
  }

  if (result.status === 'unavailable') return result;
  if (result.status === 'not_found') {
    return {
      status: 'unavailable',
      error: {
        kind: 'integrity',
        operation: 'pdp_core_snapshot',
        retryable: false,
      },
    };
  }

  const row = result.value;
  if (row.resolution_status === 'not_found') {
    return { status: 'not_found' };
  }
  if (!isJsonObject(row.product_data)) {
    return {
      status: 'unavailable',
      error: {
        kind: 'integrity',
        operation: 'pdp_core_snapshot',
        retryable: false,
      },
    };
  }

  if (row.resolution_status === 'found') {
    // The RPC bounds product_variants at 128 rows and flags overflow via
    // variants_truncated. A partial product must never become a cache entry,
    // and the unbounded full-variant RPC is never used as a fallback. The
    // linked 2026-07-11 production audit found a 72-variant maximum; if the
    // product roadmap allows more than 128, add bounded keyset pagination in
    // a later append-only migration before relaxing this guard.
    if (row.product_data.variants_truncated === true) {
      return {
        status: 'unavailable',
        error: {
          code: 'variants_truncated',
          kind: 'integrity',
          operation: 'pdp_core_snapshot',
          retryable: false,
        },
      };
    }
    return {
      status: 'found',
      value: { kind: 'product', product: row.product_data },
    };
  }
  if (row.resolution_status === 'redirect') {
    return {
      status: 'found',
      value: { kind: 'redirect', target: row.product_data },
    };
  }

  return {
    status: 'unavailable',
    error: {
      kind: 'integrity',
      operation: 'pdp_core_snapshot',
      retryable: false,
    },
  };
}
