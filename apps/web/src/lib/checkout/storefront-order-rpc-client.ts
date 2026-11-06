import type { SupabaseClient } from '@supabase/supabase-js';
import 'server-only';
import { createScopedClient } from '@/lib/supabase/scoped';
import { signScopedSupabaseJwt } from '@/lib/supabase/scoped-jwt';

const STOREFRONT_ORDER_CONTEXT_TTL_SECONDS = 5 * 60;

import type {
  StorefrontCheckoutBinding,
  StorefrontMerchantRateAttestation,
} from './storefront-order-claim-types';
import { validateCheckoutBinding } from './validate-checkout-binding';
import { validateMerchantRateAttestation } from './validate-merchant-rate-attestation';

export type {
  StorefrontCheckoutBinding,
  StorefrontCheckoutVariant,
  StorefrontMerchantRateAttestation,
} from './storefront-order-claim-types';

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
  merchantRateAttestation,
  checkoutBinding,
  now = new Date(),
}: {
  fallbackClient: SupabaseClient;
  hasCanonicalDeliveryMetadata: boolean;
  merchantId: string;
  userId: string | null;
  redvaultCustomerEmail?: string;
  /** Supplied only after the server verified the selected merchant rate. */
  merchantRateAttestation?: StorefrontMerchantRateAttestation;
  /** Supplied only after server-side shared-cart authority and request hash validation. */
  checkoutBinding?: StorefrontCheckoutBinding;
  now?: Date;
}): SupabaseClient {
  const normalizedMerchantId = merchantId.trim();
  if (!normalizedMerchantId) {
    throw new Error('Storefront order merchant context is required');
  }
  const validatedCheckoutBinding =
    checkoutBinding !== undefined
      ? validateCheckoutBinding(checkoutBinding)
      : undefined;
  const validatedMerchantRateAttestation =
    merchantRateAttestation !== undefined
      ? validatedCheckoutBinding === undefined
        ? (() => {
            throw new Error(
              'Merchant rate attestation requires a checkout binding'
            );
          })()
        : validateMerchantRateAttestation({
            merchantId: normalizedMerchantId,
            attestation: merchantRateAttestation,
            checkoutBinding: validatedCheckoutBinding,
            hasCanonicalDeliveryMetadata,
          })
      : undefined;
  if (
    validatedCheckoutBinding?.delivery_mode === 'merchant_rate' &&
    validatedMerchantRateAttestation === undefined
  ) {
    throw new Error(
      'merchant_rate checkout binding requires a rate attestation'
    );
  }
  const scopedMerchantId =
    validatedMerchantRateAttestation?.merchant_id ?? normalizedMerchantId;

  try {
    const issuedAt = Math.floor(now.getTime() / 1000);
    const payload: Record<string, unknown> = {
      aud: 'authenticated',
      exp: issuedAt + STOREFRONT_ORDER_CONTEXT_TTL_SECONDS,
      iat: issuedAt,
      role: 'authenticated',
      storefront_order_context: 'route',
      storefront_order_merchant_id: scopedMerchantId,
    };

    if (hasCanonicalDeliveryMetadata) {
      payload.storefront_order_hash_version = 2;
    }
    if (validatedMerchantRateAttestation) {
      payload.storefront_merchant_rate_attestation =
        validatedMerchantRateAttestation;
    }
    if (validatedCheckoutBinding) {
      payload.storefront_checkout_binding = validatedCheckoutBinding;
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
