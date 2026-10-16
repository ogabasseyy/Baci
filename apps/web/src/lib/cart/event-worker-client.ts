import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * No service/admin fallback; PostgREST verifies this narrowly scoped
 * JWT. When COMMERCE_CART_WORKER_JWT_FILE points at a token file, the
 * token is re-read on every construction so an external rotator can
 * replace it without restarting a long-running --loop worker.
 *
 * The header/claim parsing below is shape-only (algorithm allowlist,
 * role, expiry): the signature is deliberately not verified here
 * because the worker holds no JWT secret/JWKS trust root. PostgREST
 * is the verifying party; a self-signed or otherwise invalid token
 * constructs a client whose first RPC fails authentication, which the
 * worker surfaces as `publisher unavailable` — operators should treat
 * that first-pass failure after a token change as a misconfiguration
 * signal, not a transient outage.
 */
export function createCartEventWorkerClient(
  env: Partial<NodeJS.ProcessEnv> = process.env,
  create: typeof createClient = createClient,
  now = new Date()
): SupabaseClient {
  const fail = () => new Error('Cart event worker authority unavailable');
  let token = env.COMMERCE_CART_WORKER_JWT?.trim();
  const tokenFile = env.COMMERCE_CART_WORKER_JWT_FILE?.trim();
  if (tokenFile) {
    try {
      token = readFileSync(tokenFile, 'utf8').trim();
    } catch {
      throw fail();
    }
  }
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!token || !url || !anon) throw fail();
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some((part) => !part)) throw fail();
    const header: unknown = JSON.parse(
      Buffer.from(parts[0], 'base64url').toString('utf8')
    );
    const claims: unknown = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8')
    );
    if (
      typeof header !== 'object' ||
      !header ||
      !('alg' in header) ||
      !['HS256', 'ES256', 'RS256'].includes(String(header.alg))
    )
      throw fail();
    if (
      typeof claims !== 'object' ||
      !claims ||
      !('role' in claims) ||
      claims.role !== 'commerce_cart_worker' ||
      !('exp' in claims) ||
      typeof claims.exp !== 'number' ||
      !Number.isFinite(claims.exp) ||
      // Accept the token until its actual expiry: the loop re-reads
      // the token file on every pass, so a near-expiry token can
      // finish a batch and the next pass picks up the rotated token
      // instead of the worker dying minutes before rotation.
      claims.exp * 1000 <= now.getTime()
    )
      throw fail();
    const endpoint = new URL(url);
    if (
      endpoint.protocol !== 'https:' ||
      endpoint.username ||
      endpoint.password
    )
      throw fail();
  } catch {
    throw fail();
  }
  return create(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}
