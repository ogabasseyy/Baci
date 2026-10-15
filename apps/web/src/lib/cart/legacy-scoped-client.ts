import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAnonKey, getSupabaseUrl } from '@/env';
import { getAgenticJwtSigningMaterial } from '@/lib/agentic/jwt-signing-material';
import { signScopedSupabaseJwt } from '@/lib/supabase/scoped-jwt';
import type { LegacyCartProvider } from './legacy-migration';
import type { CartPrincipal } from './principal';

/** Broker-only attestation; normal storefront proofs cannot add legacy claims. */
export function createLegacyOwnerScopedClient(
  principal: CartPrincipal,
  owner: { provider: LegacyCartProvider; hash: string; agentId?: string | null }
) {
  const now = Math.floor(Date.now() / 1000);
  const token = signScopedSupabaseJwt(
    {
      aud: 'authenticated',
      role: 'commerce_cart_shopper',
      sub: principal.principalId,
      iat: now,
      exp: now + 300,
      cart_scope: 'bootstrap',
      cart_principal_id: principal.principalId,
      cart_merchant_id: principal.merchantId,
      cart_legacy_provider: owner.provider,
      cart_legacy_hash: owner.hash,
      ...(owner.agentId ? { cart_legacy_agent_id: owner.agentId } : {}),
    },
    getAgenticJwtSigningMaterial()
  );
  return createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}
