import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Startup/readiness probe: one read-only cart-get RPC with a fresh random
 * token proves the worker JWT authenticates (signature, issuer, project,
 * role, grants) before the server listens. Returns null when verified,
 * else the token-free failure code. Never throws and never mutates: get
 * is read-only and the token names no row. Split from the guest-cart
 * store to hold the 300-line file budget; the probe needs only the raw
 * client, never store state.
 */
export async function probeGuestCartCapability(
  supabase: Pick<SupabaseClient, 'rpc'>
): Promise<string | null> {
  try {
    const { error } = await supabase.rpc('get_mcp_guest_cart', {
      p_token: randomBytes(32).toString('hex'),
    });
    if (!error) return null;
    const code: unknown = (error as { code?: unknown }).code;
    return typeof code === 'string' && code !== '' ? code : 'unknown';
  } catch {
    return 'unknown';
  }
}
