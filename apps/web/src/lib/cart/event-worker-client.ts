import { Buffer } from 'node:buffer';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** No service/admin fallback; PostgREST verifies this narrowly scoped JWT. */
export function createCartEventWorkerClient(
  env: Partial<NodeJS.ProcessEnv> = process.env,
  create: typeof createClient = createClient,
  now = new Date()
): SupabaseClient {
  const fail = () => new Error('Cart event worker authority unavailable');
  const token = env.COMMERCE_CART_WORKER_JWT?.trim();
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
      claims.exp * 1000 <= now.getTime() + 300000
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
