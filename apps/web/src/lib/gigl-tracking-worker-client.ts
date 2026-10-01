import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

type GiglTrackingRpcClient = Pick<SupabaseClient<Database>, 'rpc'>;

const EXPECTED_WORKER_ROLE = 'gigl_tracking_worker';
const RESTRICTED_RPC_NAMES: Readonly<Record<string, string>> = {
  apply_gigl_tracking_result: 'gigl_worker_apply_tracking_result',
  claim_due_gigl_tracking_monitors: 'gigl_worker_claim_due_tracking_monitors',
  pause_gigl_tracking_monitor: 'gigl_worker_pause_tracking_monitor',
  record_gigl_tracking_failure: 'gigl_worker_record_tracking_failure',
  release_gigl_tracking_claim: 'gigl_worker_release_tracking_claim',
};
const SUPPORTED_SIGNING_ALGORITHMS = new Set(['ES256', 'HS256']);

function parseJwtPart(token: string, index: number): Record<string, unknown> {
  const value = token.split('.')[index];
  if (!value) throw new Error('JWT part is missing');
  const parsed: unknown = JSON.parse(
    Buffer.from(value, 'base64url').toString('utf8')
  );
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('JWT part is invalid');
  }
  return parsed as Record<string, unknown>;
}

// Runtime construction accepts any unexpired token so rotation can occur any
// time before exp; the 24-hour rotation runway is enforced separately by the
// VPS preflight (preflight-direct-web-workers.mjs), not here. This is an
// expiry/role pre-check only: it never verifies the JWT signature or issuer.
// A mis-issued token surfaces at PostgREST, and the live scope smoke (not
// this check) is the real proof of token validity.
function hasCurrentWorkerCapability(token: string): boolean {
  try {
    if (token.split('.').length !== 3) return false;
    const header = parseJwtPart(token, 0);
    const claims = parseJwtPart(token, 1);
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

/** Creates the five-operation PostgREST capability used by the VPS poller. */
export function createGiglTrackingWorkerClient(
  env: Readonly<Record<string, string | undefined>>
): GiglTrackingRpcClient {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const workerToken = env.GIGL_TRACKING_WORKER_TOKEN?.trim();
  if (
    !url ||
    !anonKey ||
    !workerToken ||
    !hasCurrentWorkerCapability(workerToken)
  ) {
    throw new Error('GIGL tracking worker database capability is invalid');
  }

  const client = createClient<Database>(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: { headers: { Authorization: `Bearer ${workerToken}` } },
  });
  // Bind through a minimal signature: resolving the generic Supabase rpc
  // overloads against Database here exceeds type-instantiation depth.
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
    rpc: ((
      functionName: string,
      args?: Record<string, unknown>,
      options?: {
        count?: 'exact' | 'planned' | 'estimated';
        get?: boolean;
        head?: boolean;
      }
    ) => {
      const restrictedName = RESTRICTED_RPC_NAMES[functionName];
      if (!restrictedName) {
        throw new Error('Unsupported GIGL tracking database operation');
      }
      return rpc(restrictedName as never, args as never, options);
    }) as unknown as GiglTrackingRpcClient['rpc'],
  };
}
