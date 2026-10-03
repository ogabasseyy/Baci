import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

type GiglTrackingRpcClient = Pick<SupabaseClient<Database>, 'rpc'>;

// The worker token is absent, expired, or mis-signed: there is no
// usable JWT to abuse. The disabled-branch smoke treats ONLY this class
// as vacuous; every other construction failure fails closed, because a
// valid JWT may still be usable against the correct endpoint unprobed.
export class GiglWorkerTokenError extends Error {}

// The token is present, well-formed, unexpired, and acceptably signed,
// but its role is not the worker role (including a missing role claim).
// This is a LIVE credential — PostgREST would accept it outside the
// worker hook — so it must never be mistaken for the vacuous class
// above: a disabled setup holding a service_role JWT latches nothing.
// Deliberately NOT a GiglWorkerTokenError subclass, so the disabled
// smoke's instanceof check fails closed on it.
export class GiglWorkerTokenRoleError extends Error {}

const EXPECTED_WORKER_ROLE = 'gigl_tracking_worker';
// Production Supabase project (public: NEXT_PUBLIC_* values ship in
// client bundles). The worker JWT travels in the Authorization header,
// so a mistyped or substituted URL would exfiltrate it to an origin
// that can replay it against the real endpoint; the host pin below is
// the backstop. GIGL_SUPABASE_ORIGIN_ALLOWLIST (comma-separated
// hostnames, no scheme or port) EXTENDS this pin for preview, local,
// and test origins — it can only add origins, never remove the pin.
const EXPECTED_SUPABASE_HOST = 'aivqthbxdshhltbwipbr.supabase.co';

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/, '');
}
const RESTRICTED_RPC_NAMES: Readonly<Record<string, string>> = {
  apply_gigl_tracking_result: 'gigl_worker_apply_tracking_result',
  claim_due_gigl_tracking_monitors: 'gigl_worker_claim_due_tracking_monitors',
  pause_gigl_tracking_monitor: 'gigl_worker_pause_tracking_monitor',
  record_gigl_tracking_failure: 'gigl_worker_record_tracking_failure',
  release_gigl_tracking_claim: 'gigl_worker_release_tracking_claim',
};
// Supabase JWT signing keys support all three: ES256 (Elliptic Curve),
// RS256 (RSA), and HS256 (shared secret) —
// https://supabase.com/docs/guides/auth/signing-keys. Rejecting RS256
// would refuse genuinely RSA-signed worker tokens and misclassify them
// as vacuous (absent/expired/mis-signed) in disabled setups.
const SUPPORTED_SIGNING_ALGORITHMS = new Set(['ES256', 'HS256', 'RS256']);

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

// Same usability bar as hasCurrentWorkerCapability (well-formed,
// acceptably signed, unexpired) but WITHOUT the worker role: true
// exactly when the token is a live credential PostgREST would accept
// outside the worker hook. Expired, malformed, and mis-signed tokens
// are unusable and stay in the vacuous class.
function hasUsableNonWorkerCapability(token: string): boolean {
  try {
    if (token.split('.').length !== 3) return false;
    const header = parseJwtPart(token, 0);
    const claims = parseJwtPart(token, 1);
    return (
      typeof header.alg === 'string' &&
      SUPPORTED_SIGNING_ALGORITHMS.has(header.alg) &&
      claims.role !== EXPECTED_WORKER_ROLE &&
      typeof claims.exp === 'number' &&
      claims.exp * 1000 > Date.now()
    );
  } catch {
    return false;
  }
}

function createValidatedPostgrestClient(
  env: Readonly<Record<string, string | undefined>>
) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const workerToken = env.GIGL_TRACKING_WORKER_TOKEN?.trim();
  // Token first: a missing/expired token is vacuous even when the URL
  // is also misconfigured (nothing usable to abuse either way). A
  // usable non-worker JWT is NOT vacuous — it is a distinct fail-closed
  // class, so the disabled smoke cannot latch it as "missing". The
  // role claim is never echoed: it is attacker-influenced log bytes.
  if (!workerToken || !hasCurrentWorkerCapability(workerToken)) {
    if (workerToken && hasUsableNonWorkerCapability(workerToken)) {
      throw new GiglWorkerTokenRoleError(
        'GIGL tracking worker token is a usable non-worker JWT; refusing to scope a privileged credential to the poller'
      );
    }
    throw new GiglWorkerTokenError(
      'GIGL tracking worker database capability is invalid'
    );
  }
  if (!url || !anonKey) {
    throw new Error('GIGL tracking worker database capability is invalid');
  }
  // The worker JWT travels in the Authorization header on every call, so
  // an http: misconfiguration would expose it over plaintext transport
  // (neither this check's predecessors nor the VPS preflight constrained
  // the scheme). This helper is the single validation choke point behind
  // both constructors below: refuse to build a client that would send
  // the token anywhere but a credential-free https: URL.
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error('GIGL tracking worker database capability is invalid');
  }
  if (
    parsedUrl.protocol !== 'https:' ||
    parsedUrl.username !== '' ||
    parsedUrl.password !== ''
  ) {
    throw new Error(
      'GIGL tracking worker Supabase URL must be a credential-free https:// URL'
    );
  }
  const allowedOrigins = new Set(
    (env.GIGL_SUPABASE_ORIGIN_ALLOWLIST ?? '')
      .split(',')
      .map((entry) => normalizeHostname(entry))
      .filter((entry) => entry !== '')
  );
  allowedOrigins.add(EXPECTED_SUPABASE_HOST);
  if (!allowedOrigins.has(normalizeHostname(parsedUrl.hostname))) {
    throw new Error(
      'GIGL tracking worker Supabase URL host is not an allowed origin'
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
  return rpc;
}

/** Creates the five-operation PostgREST capability used by the VPS poller. */
export function createGiglTrackingWorkerClient(
  env: Readonly<Record<string, string | undefined>>
): GiglTrackingRpcClient {
  const rpc = createValidatedPostgrestClient(env);
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

/**
 * Smoke-only raw client for the scope path probe: identical
 * validation, origin pin, and worker-JWT authorization, but NO RPC
 * name remapping, so the probe can POST an out-of-allowlist path and
 * require the hook's denial. The restricted client above remaps every
 * known name to an approved wrapper (or throws), which makes hook
 * path enforcement unobservable through it. Never used by the
 * poller or fallback route — they must stay mapped; the PostgREST
 * scope hook still confines whatever this client sends.
 */
export function createGiglTrackingWorkerScopeProbeClient(
  env: Readonly<Record<string, string | undefined>>
): GiglTrackingRpcClient {
  const rpc = createValidatedPostgrestClient(env);
  return {
    rpc: ((
      functionName: string,
      args?: Record<string, unknown>,
      options?: {
        count?: 'exact' | 'planned' | 'estimated';
        get?: boolean;
        head?: boolean;
      }
    ) =>
      rpc(
        functionName as never,
        args as never,
        options
      )) as unknown as GiglTrackingRpcClient['rpc'],
  };
}
