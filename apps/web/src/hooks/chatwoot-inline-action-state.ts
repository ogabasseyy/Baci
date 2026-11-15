type CartRef = { cartId: string; version: number } | null;

/**
 * Tracks which inline actions are still current. Cart actions supersede one
 * another (the newest wins). Product lookups are read-only and keyed by their
 * own request id, so they stay current until the conversation or session
 * context is replaced, even while other lookups or cart actions run.
 */
export function createChatwootActionGenerations() {
  let latest = 0;
  let context = 0;
  return {
    beginContext() {
      context += 1;
      latest += 1;
    },
    startAction(independent: boolean) {
      const startedContext = context;
      const generation = independent ? latest : ++latest;
      return {
        isCurrent: () =>
          independent ? context === startedContext : generation === latest,
      };
    },
  };
}

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
  const authorizedVersionIsCurrent = isMutation
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
    requestedCartRef !== null &&
    currentCartRef?.cartId === requestedCartRef.cartId &&
    (event === 'baci-cart-add' ||
      (isProduct
        ? currentCartRef.version >= requestedCartRef.version
        : currentCartRef.version === requestedCartRef.version));
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

const ACTION_EVENTS = new Set([
  'baci-cart-request',
  'baci-cart-add',
  'baci-cart-quantity',
  'baci-product-request',
  'baci-checkout-review-request',
]);

export function isChatwootInlineActionEvent(event: string) {
  return ACTION_EVENTS.has(event);
}
