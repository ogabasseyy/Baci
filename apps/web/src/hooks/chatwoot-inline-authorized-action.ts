import type { authorizeChatwootBridgeSession } from '@/components/storefront/ogabassey/components/chat/chatwoot-bridge-session';
import { postChatwootCanonicalCartView } from '@/components/storefront/ogabassey/components/chat/chatwoot-inline-cart-controls';
import { handleChatwootInlineProductLookup } from '@/components/storefront/ogabassey/components/chat/chatwoot-inline-product-lookup';
import type { useCart } from '@/hooks/cart';
import type { ChatwootCommerceMessage } from '@/schemas/chatwoot-commerce-message';
import { handleChatwootCheckoutAction } from './chatwoot-checkout-action';
import type { ChatwootCheckoutMerchant } from './chatwoot-checkout-merchant';
import { handleChatwootDeliveryOptionsAction } from './chatwoot-delivery-options-action';
import { createChatwootInlineActionContext } from './chatwoot-inline-cart-action-context';
import { dispatchChatwootInlineCartMutation } from './chatwoot-inline-cart-mutation-dispatch';

type CartState = ReturnType<typeof useCart>;
type Authorized = NonNullable<
  Awaited<ReturnType<typeof authorizeChatwootBridgeSession>>
>;

export interface AuthorizedChatwootActionInput {
  message: ChatwootCommerceMessage;
  authorized: Authorized;
  /** Session token the action was authorized with. */
  actionSessionToken: string;
  conversationId: number;
  requestId: string;
  storeSlug: string;
  action: { canApplyRenewal: () => boolean; isCurrent: () => boolean };
  requestedCartRef: { cartId: string; version: number } | null;
  requestedMerchantSlug: string | null | undefined;
  lineTokens: Map<string, string>;
  /** Post a prefixed JSON message to the widget frame. */
  post: (prefix: string, value: unknown) => void;
  /** Post an already-serialized message to the widget frame. */
  postRawPayload: (payload: string) => void;
  getCartState: () => CartState;
  getMerchant: () => ChatwootCheckoutMerchant | null;
  getSessionExpiresAt: () => number;
  getAuthorizedSessionToken: () => string | null;
  hasSessionAlias: () => boolean;
  isCurrentTarget: () => boolean;
  onSessionTokenRenewed: (sessionToken: string) => void;
}

/** Runs one authorized, still-fresh widget action against the storefront cart. */
export async function dispatchChatwootAuthorizedAction(
  input: AuthorizedChatwootActionInput
): Promise<void> {
  const { message, authorized, requestId, conversationId, storeSlug } = input;
  if (message.event === 'baci-cart-request') {
    postChatwootCanonicalCartView({
      requestId,
      snapshot: authorized.snapshot,
      lineTokens: input.lineTokens,
      post: input.postRawPayload,
    });
    return;
  }
  const actionContext = createChatwootInlineActionContext({
    canApplyRenewal: input.action.canApplyRenewal,
    getCartState: input.getCartState,
    isCurrentGeneration: input.action.isCurrent,
    getSessionExpiresAt: input.getSessionExpiresAt,
    hasSessionAlias: input.hasSessionAlias,
    isCurrentTarget: input.isCurrentTarget,
    onSessionTokenRenewed: input.onSessionTokenRenewed,
    requestedCartRef: input.requestedCartRef,
    requestedMerchantSlug: input.requestedMerchantSlug,
  });
  if (message.event === 'baci-product-request') {
    await handleChatwootInlineProductLookup({
      conversationId,
      isCurrentAction: actionContext.isCurrentLookup,
      post: input.post,
      requestId,
      sessionToken: input.actionSessionToken,
      slug: message.data.slug,
      storeSlug,
    });
    return;
  }
  const getCurrentCartRef = () => input.getCartState().sharedCartRef ?? null;
  if (message.event === 'baci-delivery-options-request') {
    await handleChatwootDeliveryOptionsAction({
      requestId,
      conversationId,
      sessionToken: input.actionSessionToken,
      state: message.data.state,
      storeSlug,
      snapshot: authorized.snapshot,
      authorizedCartId: authorized.cartId,
      requestedCartRef: input.requestedCartRef,
      getCurrentCartRef,
      isCurrent: () =>
        actionContext.isCurrentAction() &&
        input.getSessionExpiresAt() > Date.now(),
      postResult: (result) =>
        input.post('baci-delivery-options-result:', result),
    });
    return;
  }
  if (
    message.event === 'baci-checkout-place-request' ||
    message.event === 'baci-checkout-payment-status-request'
  ) {
    await handleChatwootCheckoutAction({
      message,
      post: input.post,
      storeSlug,
      snapshot: authorized.snapshot,
      authorizedCartId: authorized.cartId,
      requestedCartRef: input.requestedCartRef,
      getCurrentCartRef,
      getDisplayCart: () => input.getCartState().cart,
      getMerchant: input.getMerchant,
      isCurrent: () =>
        actionContext.isCurrentAction() &&
        input.getSessionExpiresAt() > Date.now(),
      canPost: actionContext.isCurrentContext,
    });
    return;
  }
  await dispatchChatwootInlineCartMutation({
    ...actionContext,
    conversationId,
    getSessionToken: () =>
      input.getAuthorizedSessionToken() ?? input.actionSessionToken,
    lineTokens: input.lineTokens,
    message,
    postRaw: input.post,
    refreshSharedCart: input.getCartState().refreshSharedCart,
    requestId,
    sessionExpiresAt: input.getSessionExpiresAt(),
    sessionToken: input.actionSessionToken,
    snapshot: authorized.snapshot,
    storeSlug,
  });
}
