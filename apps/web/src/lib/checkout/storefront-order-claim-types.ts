import type { OrderBindingVariant } from '@/lib/cart/order-binding-types';

export type StorefrontCheckoutVariant = OrderBindingVariant | 'redvault';

/**
 * Server-verified merchant rate context. All money values are integer minor
 * units. This signed transport claim is not enforcement by itself; the order
 * binder must independently validate it against session and current DB state.
 */
export type StorefrontMerchantRateAttestation = {
  shippingRateId: string;
  shippingConfigRevision: string;
  /** Validated pre-discount goods plus server-rated assurance, excluding delivery. */
  canonicalSubtotalMinor: number;
  destinationCountryCode: string;
  destinationSubdivisionCode: string | null;
  shippingFeeMinor: number;
  fulfillmentKind: 'ship' | 'pickup';
};

/** Server-verified checkout identity; never contains session bearer material. */
type StorefrontCheckoutBindingBase = {
  cartId: string;
  checkoutSessionId: string;
  checkoutGeneration: number;
  cartVersion: number;
  principalId: string;
  checkoutVariant: StorefrontCheckoutVariant;
  deliveryMode: 'merchant_rate' | 'no_merchant_rate' | 'replay';
};

export type StorefrontCheckoutBinding =
  | (StorefrontCheckoutBindingBase & {
      identityKind: 'idempotent';
      checkoutVariant: Exclude<StorefrontCheckoutVariant, 'quiz_voucher'>;
      idempotencyKey: string;
      /** SHA-256 hex of the canonical request hash submitted to the order RPC. */
      checkoutRequestHash: string;
    })
  | (StorefrontCheckoutBindingBase & {
      identityKind: 'quiz_voucher';
      checkoutVariant: 'quiz_voucher';
      voucherAwardId: string;
    });

export type ValidatedStorefrontMerchantRateAttestation = {
  version: 1;
  merchant_id: string;
  shipping_rate_id: string;
  shipping_config_revision: string;
  canonical_subtotal_minor: number;
  destination_country_code: string;
  destination_subdivision_code: string | null;
  shipping_fee_minor: number;
  fulfillment_kind: 'ship' | 'pickup';
};

export type ValidatedStorefrontCheckoutBinding = {
  version: 1;
  cart_id: string;
  checkout_session_id: string;
  checkout_generation: number;
  cart_version: number;
  principal_id: string;
  delivery_mode: 'merchant_rate' | 'no_merchant_rate' | 'replay';
  identity_kind: 'idempotent' | 'quiz_voucher';
  checkout_variant: StorefrontCheckoutVariant;
  idempotency_key?: string;
  checkout_request_hash?: string;
  voucher_award_id?: string;
};
