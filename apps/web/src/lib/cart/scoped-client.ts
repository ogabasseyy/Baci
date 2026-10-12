import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import 'server-only';
import { getSupabaseAnonKey, getSupabaseUrl } from '@/env';
import type { AgenticJwtSigningMaterial } from '@/lib/agentic/jwt-signing-material';
import { getAgenticJwtSigningMaterial } from '@/lib/agentic/jwt-signing-material';
import { signScopedSupabaseJwt } from '@/lib/supabase/scoped-jwt';
import type { CartPrincipal } from './principal';

/** Scoped cart tokens never outlive five minutes. */
export const CART_SCOPED_TOKEN_TTL_SECONDS = 5 * 60;

export const CART_SHOPPER_ROLE = 'commerce_cart_shopper';
export const CART_RECEIVER_ROLE = 'commerce_cart_receiver';

export interface CartScopedClientOptions {
  now?: Date;
  signer?: AgenticJwtSigningMaterial;
  supabaseUrl?: string;
  anonKey?: string;
}

function buildCartToken(
  principal: CartPrincipal,
  role: typeof CART_SHOPPER_ROLE | typeof CART_RECEIVER_ROLE,
  options: CartScopedClientOptions
): string {
  const now = options.now ?? new Date();
  const issuedAt = Math.floor(now.getTime() / 1000);
  const payload: Record<string, unknown> = {
    aud: 'authenticated',
    cart_merchant_id: principal.merchantId,
    cart_principal_id: principal.principalId,
    cart_scope: principal.scope,
    exp: issuedAt + CART_SCOPED_TOKEN_TTL_SECONDS,
    iat: issuedAt,
    role,
    sub: principal.principalId,
  };
  if (principal.cartId) {
    payload.cart_id = principal.cartId;
  }
  if (principal.grantId) {
    payload.cart_grant_id = principal.grantId;
  }
  return signScopedSupabaseJwt(
    payload,
    options.signer ?? getAgenticJwtSigningMaterial()
  );
}

function buildScopedClient(
  token: string,
  options: CartScopedClientOptions
): SupabaseClient {
  return createClient(
    options.supabaseUrl ?? getSupabaseUrl(),
    options.anonKey ?? getSupabaseAnonKey(),
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    }
  );
}

/**
 * Short-lived PostgREST client for shopper cart operations. Claims are
 * minted server-side from a verified principal; the role carries only
 * the narrow cart grants, never the broad authenticated role.
 */
export function createCartScopedClient(
  principal: CartPrincipal,
  options: CartScopedClientOptions = {}
): SupabaseClient {
  return buildScopedClient(
    buildCartToken(principal, CART_SHOPPER_ROLE, options),
    options
  );
}

/**
 * Receive-only client for private cart notifications. It cannot read or
 * mutate cart tables; topic access is granted separately per cart.
 */
export function createCartReceiveClient(
  principal: CartPrincipal,
  options: CartScopedClientOptions = {}
): SupabaseClient {
  return buildScopedClient(
    buildCartToken(principal, CART_RECEIVER_ROLE, options),
    options
  );
}
