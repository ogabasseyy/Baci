import { ORDER_BINDING_VARIANTS } from '@/lib/cart/order-binding-types';
import type {
  StorefrontCheckoutBinding,
  StorefrontCheckoutVariant,
  ValidatedStorefrontCheckoutBinding,
} from './storefront-order-claim-types';

const STOREFRONT_CHECKOUT_VARIANTS: readonly StorefrontCheckoutVariant[] = [
  ...ORDER_BINDING_VARIANTS,
  'redvault',
];
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_POSTGRES_INT = 2_147_483_647;
const CHECKOUT_IDEMPOTENCY_KEY_MIN_BYTES = 16;
const CHECKOUT_IDEMPOTENCY_KEY_MAX_BYTES = 128;
const CHECKOUT_BINDING_OPAQUE_ID_MAX_BYTES = 128;

export function validateCheckoutBinding(
  checkoutBinding: StorefrontCheckoutBinding
): ValidatedStorefrontCheckoutBinding {
  const cartId = checkoutBinding.cartId.trim().toLowerCase();
  const checkoutSessionId = checkoutBinding.checkoutSessionId
    .trim()
    .toLowerCase();
  if (!UUID_PATTERN.test(cartId) || !UUID_PATTERN.test(checkoutSessionId)) {
    throw new Error('Checkout binding requires UUID cart and session ids');
  }
  for (const [field, value] of [
    ['checkout generation', checkoutBinding.checkoutGeneration],
    ['cart version', checkoutBinding.cartVersion],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1 || value > MAX_POSTGRES_INT) {
      throw new Error(
        `Checkout binding ${field} must be a positive PostgreSQL integer`
      );
    }
  }
  const principalId = checkoutBinding.principalId;
  const principalIdBytes = Buffer.byteLength(principalId, 'utf8');
  if (
    principalId.trim().length === 0 ||
    principalIdBytes > CHECKOUT_BINDING_OPAQUE_ID_MAX_BYTES
  ) {
    throw new Error('Checkout binding principal id is malformed');
  }
  if (
    checkoutBinding.deliveryMode !== 'merchant_rate' &&
    checkoutBinding.deliveryMode !== 'no_merchant_rate' &&
    checkoutBinding.deliveryMode !== 'replay'
  ) {
    throw new Error('Checkout binding delivery mode is invalid');
  }
  const checkoutVariantValue: string = checkoutBinding.checkoutVariant;
  if (
    !STOREFRONT_CHECKOUT_VARIANTS.some(
      (variant) => variant === checkoutVariantValue
    ) ||
    (checkoutBinding.identityKind === 'quiz_voucher' &&
      checkoutVariantValue !== 'quiz_voucher') ||
    (checkoutBinding.identityKind === 'idempotent' &&
      checkoutVariantValue === 'quiz_voucher')
  ) {
    throw new Error('Checkout binding variant does not match its identity');
  }
  const validated: ValidatedStorefrontCheckoutBinding = {
    version: 1,
    cart_id: cartId,
    checkout_session_id: checkoutSessionId,
    checkout_generation: checkoutBinding.checkoutGeneration,
    cart_version: checkoutBinding.cartVersion,
    principal_id: principalId,
    delivery_mode: checkoutBinding.deliveryMode,
    identity_kind: checkoutBinding.identityKind,
    checkout_variant: checkoutBinding.checkoutVariant,
  };
  if (checkoutBinding.identityKind === 'idempotent') {
    const idempotencyKey = checkoutBinding.idempotencyKey;
    const idempotencyKeyBytes = Buffer.byteLength(idempotencyKey, 'utf8');
    if (
      idempotencyKey !== idempotencyKey.trim() ||
      idempotencyKeyBytes < CHECKOUT_IDEMPOTENCY_KEY_MIN_BYTES ||
      idempotencyKeyBytes > CHECKOUT_IDEMPOTENCY_KEY_MAX_BYTES
    ) {
      throw new Error('Checkout binding idempotency key is malformed');
    }
    if (!/^[0-9a-f]{64}$/.test(checkoutBinding.checkoutRequestHash)) {
      throw new Error('Checkout binding request hash must be SHA-256 hex');
    }
    validated.idempotency_key = idempotencyKey;
    validated.checkout_request_hash = checkoutBinding.checkoutRequestHash;
  } else if (checkoutBinding.identityKind === 'quiz_voucher') {
    const voucherAwardId = checkoutBinding.voucherAwardId.trim().toLowerCase();
    if (!UUID_PATTERN.test(voucherAwardId)) {
      throw new Error('Voucher checkout binding requires a UUID award id');
    }
    validated.voucher_award_id = voucherAwardId;
  } else {
    throw new Error('Checkout binding identity kind is invalid');
  }
  return validated;
}
