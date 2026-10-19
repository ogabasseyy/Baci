import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { VerifiedCartCustomer } from './verified-customer';
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
export const CART_REVOKER_ROLE = 'commerce_cart_revoker';
export const CART_ACCOUNT_LINKER_ROLE = 'commerce_cart_account_linker';

export interface CartScopedClientOptions {
  now?: Date;
  signer?: AgenticJwtSigningMaterial;
  supabaseUrl?: string;
  anonKey?: string;
}

function buildCartToken(
  principal: CartPrincipal,
  role:
    | typeof CART_SHOPPER_ROLE
    | typeof CART_RECEIVER_ROLE
    | typeof CART_ACCOUNT_LINKER_ROLE
    | typeof CART_REVOKER_ROLE,
  options: CartScopedClientOptions,
  customer?: VerifiedCartCustomer
): string {
  const now = options.now ?? new Date();
  const issuedAt = Math.floor(now.getTime() / 1000);
  const proofExpiry = Math.floor(Date.parse(principal.expiresAt) / 1000);
  if (
    !Number.isFinite(proofExpiry) ||
    (proofExpiry <= issuedAt && role !== CART_REVOKER_ROLE)
  ) {
    throw new Error('Cart proof has expired');
  }
  const payload: Record<string, unknown> = {
    aud: 'authenticated',
    cart_merchant_id: principal.merchantId,
    cart_principal_id: principal.principalId,
    cart_scope: principal.scope,
    exp:
      role === CART_REVOKER_ROLE
        ? issuedAt + CART_SCOPED_TOKEN_TTL_SECONDS
        : Math.min(proofExpiry, issuedAt + CART_SCOPED_TOKEN_TTL_SECONDS),
    iat: issuedAt,
    role,
    sub: principal.principalId,
  };
  if (role === CART_ACCOUNT_LINKER_ROLE) {
    if (!customer || customer.merchantId !== principal.merchantId)
      throw new Error('Cart customer scope mismatch');
    payload.cart_account_user_id = customer.userId;
    payload.cart_customer_id = customer.customerId;
  }
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

/** Only the receive credential may cross to a linked browser/native client. */
export function issueCartReceiveAccess(
  principal: CartPrincipal,
  options: CartScopedClientOptions = {}
): { token: string; expiresAt: string } {
  const now = options.now ?? new Date();
  const token = buildCartToken(principal, CART_RECEIVER_ROLE, {
    ...options,
    now,
  });
  return {
    token,
    expiresAt: new Date(
      Math.min(
        Date.parse(principal.expiresAt),
        (Math.floor(now.getTime() / 1000) + CART_SCOPED_TOKEN_TTL_SECONDS) *
          1000
      )
    ).toISOString(),
  };
}

/** Server-only dual authority: verified cart proof plus independently authenticated customer. */
export function createCartAccountScopedClient(
  principal: CartPrincipal,
  customer: VerifiedCartCustomer,
  options: CartScopedClientOptions = {}
): SupabaseClient {
  return buildScopedClient(
    buildCartToken(principal, CART_ACCOUNT_LINKER_ROLE, options, customer),
    options
  );
}

/** Only retires device grants; this role cannot read or mutate cart contents. */
export function createCartRevocationClient(
  principal: CartPrincipal,
  options: CartScopedClientOptions = {}
): SupabaseClient {
  return buildScopedClient(
    buildCartToken(principal, CART_REVOKER_ROLE, options),
    options
  );
}

/** Server-only preview authority, minted after the HTTP client quota passes. */
export function createCartPreviewClient(
  handoffId: string,
  options: CartScopedClientOptions = {}
): SupabaseClient {
  const issuedAt = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const token = signScopedSupabaseJwt(
    {
      aud: 'authenticated',
      role: 'commerce_cart_previewer',
      cart_handoff_id: handoffId,
      iat: issuedAt,
      exp: issuedAt + CART_SCOPED_TOKEN_TTL_SECONDS,
    },
    options.signer ?? getAgenticJwtSigningMaterial()
  );
  return buildScopedClient(token, options);
}
