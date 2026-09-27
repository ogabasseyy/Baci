import type { SupabaseClient } from '@supabase/supabase-js';
import 'server-only';
import { createScopedClient } from '@/lib/supabase/scoped';
import { signScopedSupabaseJwt } from '@/lib/supabase/scoped-jwt';

const STOREFRONT_ORDER_CONTEXT_TTL_SECONDS = 5 * 60;

/**
 * Creates the short-lived server context used by storefront order RPCs.
 *
 * The signed claim is deliberately kept out of the request body. The database
 * order trigger uses it to distinguish the trusted API route from direct
 * anon/authenticated RPC callers, while the caller's user id is preserved for
 * authenticated checkouts. Guest tokens omit `sub`, so auth.uid() remains null.
 */
export function createStorefrontOrderRpcClient({
  fallbackClient,
  hasCanonicalDeliveryMetadata,
  merchantId,
  userId,
  redvaultCustomerEmail,
  now = new Date(),
}: {
  fallbackClient: SupabaseClient;
  hasCanonicalDeliveryMetadata: boolean;
  merchantId: string;
  userId: string | null;
  redvaultCustomerEmail?: string;
  now?: Date;
}): SupabaseClient {
  const normalizedMerchantId = merchantId.trim();
  if (!normalizedMerchantId) {
    throw new Error('Storefront order merchant context is required');
  }

  try {
    const issuedAt = Math.floor(now.getTime() / 1000);
    const payload: Record<string, unknown> = {
      aud: 'authenticated',
      exp: issuedAt + STOREFRONT_ORDER_CONTEXT_TTL_SECONDS,
      iat: issuedAt,
      role: 'authenticated',
      storefront_order_context: 'route',
      storefront_order_merchant_id: normalizedMerchantId,
    };

    if (hasCanonicalDeliveryMetadata) {
      payload.storefront_order_hash_version = 2;
    }

    if (userId) {
      payload.sub = userId;
    }
    const normalizedRedvaultCustomerEmail = redvaultCustomerEmail
      ?.trim()
      .toLowerCase();
    if (normalizedRedvaultCustomerEmail) {
      payload.storefront_redvault_customer_email =
        normalizedRedvaultCustomerEmail;
    }

    return createScopedClient(signScopedSupabaseJwt(payload));
  } catch (error) {
    // Vitest route tests intentionally use an injected mock client and do not
    // provision JWT signing material. Production remains fail-closed: a
    // missing/invalid signing key must not fall back to an untrusted client.
    if (process.env.NODE_ENV === 'test') {
      return fallbackClient;
    }
    throw error;
  }
}
