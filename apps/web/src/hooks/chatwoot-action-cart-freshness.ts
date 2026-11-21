type CartRef = { cartId: string; version: number } | null;

/** Cart-ref and cart-version freshness for an authorized inline action. */
export function evaluateChatwootActionCartFreshness(input: {
  authorizedVersion: number | null;
  currentCartRef: CartRef;
  event: string;
  generationIsCurrent?: boolean;
  merchantSlug?: string | null;
  requestedCartRef: CartRef;
  requestedMerchantSlug?: string | null;
}) {
  const { authorizedVersion, currentCartRef, event, requestedCartRef } = input;
  const isMutation =
    event === 'baci-cart-add' || event === 'baci-cart-quantity';
  const isProduct = event === 'baci-product-request';
  // In-chat checkout runs its own cart checks. Placing an order moves the cart
  // version on, so a retry of that placement, or a poll of its payment, must
  // still reach the handler: it answers a repeat from the remembered order and
  // applies the exact-version checks itself before creating a new one.
  const isPaymentStatus =
    event === 'baci-checkout-payment-status-request' ||
    event === 'baci-checkout-place-request';
  const authorizedVersionIsCurrent = isPaymentStatus
    ? authorizedVersion !== null
    : isMutation
      ? (authorizedVersion ?? -1) >=
        (currentCartRef?.version ?? Number.POSITIVE_INFINITY)
      : isProduct
        ? authorizedVersion !== null &&
          requestedCartRef !== null &&
          currentCartRef !== null &&
          authorizedVersion >= requestedCartRef.version &&
          authorizedVersion <= currentCartRef.version
        : authorizedVersion !== null &&
          authorizedVersion === currentCartRef?.version;
  const cartRefIsCurrent =
    isPaymentStatus ||
    (requestedCartRef !== null &&
      currentCartRef?.cartId === requestedCartRef.cartId &&
      (event === 'baci-cart-add' ||
        (isProduct
          ? currentCartRef.version >= requestedCartRef.version
          : currentCartRef.version === requestedCartRef.version)));
  const merchantIsCurrent =
    !isProduct || input.merchantSlug === input.requestedMerchantSlug;
  return {
    authorizedVersionIsCurrent,
    cartRefIsCurrent,
    stillCurrent:
      input.generationIsCurrent !== false &&
      authorizedVersionIsCurrent &&
      cartRefIsCurrent &&
      merchantIsCurrent,
  };
}
