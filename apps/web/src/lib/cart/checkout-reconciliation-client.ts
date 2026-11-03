import 'server-only';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAnonKey, getSupabaseUrl } from '@/env';
import { getAgenticJwtSigningMaterial } from '@/lib/agentic/jwt-signing-material';
import { signScopedSupabaseJwt } from '@/lib/supabase/scoped-jwt';
import type { CheckoutReconciliationAuthority } from './checkout-reconciliation-proof';
import type { CartScopedClientOptions } from './scoped-client';
import { CART_REVOCATION_GRACE_SECONDS } from './session-proof';

/** Mint a short-lived, server-only shopper capability for checkout reconciliation. */
export function createCheckoutReconciliationClient(
  authority: CheckoutReconciliationAuthority,
  input: {
    generation: number;
    cartVersion: number;
    customerEmail: string;
    idempotencyKey: string;
  },
  options: CartScopedClientOptions = {}
) {
  const now = options.now ?? new Date();
  const issuedAt = Math.floor(now.getTime() / 1000);
  const expiry = Math.min(
    issuedAt + 60,
    Math.floor(Date.parse(authority.session.expiresAt) / 1000) +
      CART_REVOCATION_GRACE_SECONDS
  );
  if (
    !Number.isFinite(expiry) ||
    expiry <= issuedAt ||
    !authority.session.cartId ||
    !authority.session.grantId
  )
    throw new Error('Checkout reconciliation authority has expired');
  const token = signScopedSupabaseJwt(
    {
      aud: 'authenticated',
      role: 'commerce_cart_shopper',
      cart_scope: 'checkout_recovery',
      cart_merchant_id: authority.session.merchantId,
      cart_id: authority.session.cartId,
      cart_grant_id: authority.session.grantId,
      cart_principal_id: authority.session.principalId,
      cart_recovery_session_id: authority.sessionId,
      cart_recovery_user_id: authority.userId ?? 'guest',
      cart_recovery_generation: input.generation,
      cart_recovery_version: input.cartVersion,
      cart_recovery_email: input.customerEmail.trim().toLowerCase(),
      cart_recovery_key_hash: createHash('sha256')
        .update(input.idempotencyKey)
        .digest('hex'),
      iat: issuedAt,
      exp: expiry,
    },
    options.signer ?? getAgenticJwtSigningMaterial()
  );
  return createClient(
    options.supabaseUrl ?? getSupabaseUrl(),
    options.anonKey ?? getSupabaseAnonKey(),
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    }
  );
}
