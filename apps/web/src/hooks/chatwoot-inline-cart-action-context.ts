type SharedCartRef = { cartId: string; version: number } | null | undefined;

/**
 * Builds the freshness callbacks shared by the cart-changing inline actions
 * (add and quantity). Every callback re-reads live bridge state so an action
 * stops once the frame, conversation, session or cart it started with is gone.
 */
export function createChatwootInlineActionContext(input: {
  actionGeneration: number;
  getLatestGeneration: () => number;
  getCartState: () => {
    merchantSlug: string | null | undefined;
    sharedCartRef?: SharedCartRef;
  };
  getSessionExpiresAt: () => number;
  hasSessionAlias: () => boolean;
  isCurrentTarget: () => boolean;
  onSessionTokenRenewed: (sessionToken: string) => void;
  requestedCartRef: SharedCartRef;
  requestedMerchantSlug: string | null | undefined;
}) {
  return {
    isCurrentAction: () =>
      input.isCurrentTarget() &&
      input.actionGeneration === input.getLatestGeneration() &&
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
    onSessionTokenRenewed: (sessionToken: string) => {
      if (
        input.actionGeneration === input.getLatestGeneration() &&
        input.hasSessionAlias()
      ) {
        input.onSessionTokenRenewed(sessionToken);
      }
    },
  };
}
