import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

type CacheInvalidationRpcClient = Pick<SupabaseClient<Database>, 'rpc'>;

export class CacheInvalidationWorkerTokenError extends Error {}

const EXPECTED_WORKER_ROLE = 'cache_invalidation_worker';
const EXPECTED_SUPABASE_HOST = 'aivqthbxdshhltbwipbr.supabase.co';
const RESTRICTED_RPC_NAMES = new Set([
  'claim_cache_invalidations',
  'finish_cache_invalidation',
  'has_cache_invalidation_dead_letters',
]);
const SUPPORTED_SIGNING_ALGORITHMS = new Set(['ES256', 'HS256', 'RS256']);

function jwtPart(token: string, index: number): Record<string, unknown> {
  const encoded = token.split('.')[index];
  if (!encoded) throw new Error('JWT part is missing');
  const value: unknown = JSON.parse(
    Buffer.from(encoded, 'base64url').toString('utf8')
  );
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('JWT part is invalid');
  }
  return value as Record<string, unknown>;
}

function hasCurrentWorkerCapability(token: string): boolean {
  try {
    if (token.split('.').length !== 3) return false;
    const header = jwtPart(token, 0);
    const claims = jwtPart(token, 1);
    return (
      typeof header.alg === 'string' &&
      SUPPORTED_SIGNING_ALGORITHMS.has(header.alg) &&
      claims.role === EXPECTED_WORKER_ROLE &&
      typeof claims.exp === 'number' &&
      claims.exp * 1000 > Date.now()
    );
  } catch {
    return false;
  }
}

/** Build the cache drain's three-RPC PostgREST capability. */
export function createCacheInvalidationWorkerClient(
  env: Readonly<Record<string, string | undefined>>
): CacheInvalidationRpcClient {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const workerToken = env.CACHE_INVALIDATION_WORKER_TOKEN?.trim();
  if (!workerToken || !hasCurrentWorkerCapability(workerToken)) {
    throw new CacheInvalidationWorkerTokenError(
      'Cache invalidation worker capability is invalid'
    );
  }
  if (!url || !anonKey) {
    throw new CacheInvalidationWorkerTokenError(
      'Cache invalidation worker capability is invalid'
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new CacheInvalidationWorkerTokenError(
      'Cache invalidation worker capability is invalid'
    );
  }
  if (
    parsedUrl.protocol !== 'https:' ||
    parsedUrl.username !== '' ||
    parsedUrl.password !== ''
  ) {
    throw new Error(
      'Cache invalidation worker Supabase URL must be a credential-free https:// URL'
    );
  }
  if (
    (env.NODE_ENV ?? '').trim().toLowerCase() === 'production' &&
    parsedUrl.hostname.toLowerCase().replace(/\.$/, '') !==
      EXPECTED_SUPABASE_HOST
  ) {
    throw new Error(
      'Cache invalidation worker Supabase URL host is not an allowed origin'
    );
  }

  const client = createClient<Database>(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: { headers: { Authorization: `Bearer ${workerToken}` } },
  });
  const rpc = (
    client as unknown as {
      rpc: (
        functionName: never,
        args?: never,
        options?: Record<string, unknown>
      ) => unknown;
    }
  ).rpc.bind(client);

  return {
    rpc: (functionName, args, options) => {
      if (!RESTRICTED_RPC_NAMES.has(String(functionName))) {
        throw new Error('Unsupported cache invalidation database operation');
      }
      return rpc(functionName as never, args as never, options);
    },
  } as CacheInvalidationRpcClient;
}
