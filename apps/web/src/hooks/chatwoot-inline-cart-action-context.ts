type SharedCartRef = { cartId: string; version: number } | null | undefined;

/**
 * Builds the freshness callbacks shared by the cart-changing inline actions
 * (add and quantity). Every callback re-reads live bridge state so an action
 * stops once the frame, conversation, session or cart it started with is gone.
 */
export function createChatwootInlineActionContext(input: {
  getCartState: () => {
    merchantSlug: string | null | undefined;
    sharedCartRef?: SharedCartRef;
  };
  getSessionExpiresAt: () => number;
  hasSessionAlias: () => boolean;
  isCurrentGeneration: () => boolean;
  isCurrentTarget: () => boolean;
  onSessionTokenRenewed: (sessionToken: string) => void;
  requestedCartRef: SharedCartRef;
  requestedMerchantSlug: string | null | undefined;
}) {
  return {
    isCurrentAction: () =>
      input.isCurrentTarget() &&
      input.isCurrentGeneration() &&
      input.hasSessionAlias(),
    isCurrentCartContext: () => {
      const current = input.getCartState();
      return (
        input.isCurrentTarget() &&
        current.merchantSlug === input.requestedMerchantSlug &&
        !!input.requestedCartRef &&
        current.sharedCartRef?.cartId === input.requestedCartRef.cartId
      );
    },
    isCurrentContext: () =>
      input.isCurrentTarget() &&
      input.hasSessionAlias() &&
      input.getSessionExpiresAt() > Date.now(),
    /** A read-only product lookup: current while its own context is live. */
    isCurrentLookup: () =>
      input.isCurrentTarget() &&
      input.isCurrentGeneration() &&
      input.hasSessionAlias() &&
      input.getSessionExpiresAt() > Date.now() &&
      input.getCartState().merchantSlug === input.requestedMerchantSlug,
    onSessionTokenRenewed: (sessionToken: string) => {
      if (input.isCurrentGeneration() && input.hasSessionAlias()) {
        input.onSessionTokenRenewed(sessionToken);
      }
    },
  };
}
