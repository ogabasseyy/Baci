import { MerchantRateAttestationInputError } from './merchant-rate-attestation-input-error';
import type { SharedCartRateBinding } from './shared-cart-rate-binding';
import type {
  StorefrontCheckoutBinding,
  StorefrontCheckoutVariant,
} from './storefront-order-claim-types';

/** Creates the identity claim only from server-verified shared-cart authority. */
export function buildStorefrontCheckoutBinding({
  enabled,
  sharedCart,
  principalId,
  idempotencyKey,
  checkoutRequestHash,
  voucherAwardId,
  hasQuizVoucherItem,
  deliveryMode,
  checkoutVariant,
}: {
  enabled: boolean;
  sharedCart: SharedCartRateBinding | undefined;
  principalId: string | null;
  idempotencyKey: string | null;
  checkoutRequestHash: string | null;
  voucherAwardId?: string | null;
  hasQuizVoucherItem?: boolean;
  deliveryMode: StorefrontCheckoutBinding['deliveryMode'];
  checkoutVariant: StorefrontCheckoutVariant;
}): StorefrontCheckoutBinding | null {
  if (!enabled || !sharedCart) return null;
  if (!principalId?.trim()) {
    throw new MerchantRateAttestationInputError(
      'Trusted shared-cart principal is required'
    );
  }
  if (hasQuizVoucherItem) {
    if (
      !voucherAwardId ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        voucherAwardId
      )
    ) {
      throw new MerchantRateAttestationInputError(
        'Verified quiz voucher award id is required'
      );
    }
    if (deliveryMode === 'replay') {
      throw new MerchantRateAttestationInputError(
        'Quiz voucher replay binding is unsupported'
      );
    }
    return {
      cartId: sharedCart.cart_id,
      checkoutSessionId: sharedCart.checkout_session_id,
      checkoutGeneration: sharedCart.checkout_generation,
      cartVersion: sharedCart.cart_version,
      principalId,
      deliveryMode,
      identityKind: 'quiz_voucher',
      checkoutVariant: 'quiz_voucher',
      voucherAwardId,
    };
  }
  if (!idempotencyKey?.trim()) {
    throw new MerchantRateAttestationInputError(
      'Checkout idempotency key is required for shared-cart binding'
    );
  }
  if (!checkoutRequestHash || !/^[0-9a-f]{64}$/.test(checkoutRequestHash)) {
    throw new MerchantRateAttestationInputError(
      'Canonical checkout request hash is required for shared-cart binding'
    );
  }
  if (checkoutVariant === 'quiz_voucher') {
    throw new MerchantRateAttestationInputError(
      'Quiz voucher variant requires a verified voucher identity'
    );
  }
  return {
    cartId: sharedCart.cart_id,
    checkoutSessionId: sharedCart.checkout_session_id,
    checkoutGeneration: sharedCart.checkout_generation,
    cartVersion: sharedCart.cart_version,
    idempotencyKey: idempotencyKey.trim(),
    principalId,
    checkoutRequestHash,
    deliveryMode,
    identityKind: 'idempotent',
    checkoutVariant,
  };
}
