import { buildMerchantRateAttestation } from './build-merchant-rate-attestation';
import { buildSharedCartShippingRateMarker } from './build-shared-cart-shipping-rate-marker';
import { buildStorefrontCheckoutBinding } from './build-storefront-checkout-binding';
import { isMerchantRateAttestationEnabled } from './is-merchant-rate-attestation-enabled';
import { MerchantRateAttestationInputError } from './merchant-rate-attestation-input-error';
import type { SharedCartRateBinding } from './shared-cart-rate-binding';
import type { StorefrontCheckoutVariant } from './storefront-order-claim-types';
import type {
  StorefrontCheckoutBinding,
  StorefrontMerchantRateAttestation,
} from './storefront-order-rpc-client';

type StorefrontOrderCheckoutContextInput = {
  featureEnabled?: boolean;
  sharedCart: SharedCartRateBinding | undefined;
  principalId: string | null;
  idempotencyKey: string | null;
  checkoutRequestHash: string | null;
  checkoutVariant: StorefrontCheckoutVariant;
  hasQuizVoucherItem: boolean;
  voucherAwardId?: string | null;
  replaySignals: readonly boolean[];
  isMerchantRateOrder: boolean;
  shippingRateId: string | null | undefined;
  shippingConfigRevision: string | undefined;
  canonicalSubtotal: number | null;
  shippingFee: number;
  fulfillmentKind: 'ship' | 'pickup';
  addressCountry: string | null | undefined;
  addressState: string | null | undefined;
  merchantCountry: string | null | undefined;
};

type CheckoutContextSuccess = {
  ok: true;
  enabled: boolean;
  checkoutBinding: StorefrontCheckoutBinding | null;
  merchantRateAttestation: StorefrontMerchantRateAttestation | null;
  shippingRateMarker: { p_shipping_rate_id: string | null } | null;
};

type CheckoutContextFailure = {
  ok: false;
  enabled: true;
  status: 409;
  response: {
    code: 'SHIPPING_RATE_BINDING_UNAVAILABLE';
    error: string;
  };
  reason: string;
};

export type StorefrontOrderCheckoutContext =
  | CheckoutContextSuccess
  | CheckoutContextFailure;

/**
 * Prepares only the signed claims and marker for an order RPC. This does not
 * enforce them; the database binder must validate these claims before the
 * rollout flag can be enabled.
 */
export function prepareStorefrontOrderCheckoutContext(
  input: StorefrontOrderCheckoutContextInput
): StorefrontOrderCheckoutContext {
  const enabled = input.featureEnabled ?? isMerchantRateAttestationEnabled();
  const replay = input.replaySignals.some(Boolean);
  const deliveryMode = replay
    ? 'replay'
    : input.isMerchantRateOrder
      ? 'merchant_rate'
      : 'no_merchant_rate';
  const shippingRateMarker = buildSharedCartShippingRateMarker({
    enabled,
    sharedCart: input.sharedCart,
    shippingRateId: input.shippingRateId,
  });

  try {
    const checkoutBinding = buildStorefrontCheckoutBinding({
      enabled,
      sharedCart: input.sharedCart,
      principalId: input.principalId,
      idempotencyKey: input.idempotencyKey,
      checkoutRequestHash: input.checkoutRequestHash,
      checkoutVariant: input.checkoutVariant,
      hasQuizVoucherItem: input.hasQuizVoucherItem,
      voucherAwardId: input.voucherAwardId,
      deliveryMode,
    });
    const merchantRateAttestation = buildMerchantRateAttestation({
      enabled,
      sharedCart: input.sharedCart,
      shippingRateId: input.shippingRateId,
      shippingConfigRevision: input.shippingConfigRevision,
      canonicalSubtotal: input.canonicalSubtotal,
      shippingFee: input.shippingFee,
      fulfillmentKind: input.fulfillmentKind,
      addressCountry: input.addressCountry,
      addressState: input.addressState,
      merchantCountry: input.merchantCountry,
      isReplay: replay,
    });
    return {
      ok: true,
      enabled,
      checkoutBinding,
      merchantRateAttestation,
      shippingRateMarker,
    };
  } catch (error) {
    if (!(error instanceof MerchantRateAttestationInputError)) throw error;
    return {
      ok: false,
      enabled: true,
      status: 409,
      response: {
        code: 'SHIPPING_RATE_BINDING_UNAVAILABLE',
        error: 'Unable to bind this checkout to its verified shipping details',
      },
      reason: error.message,
    };
  }
}
