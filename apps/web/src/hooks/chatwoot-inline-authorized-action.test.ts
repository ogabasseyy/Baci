import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cartView: vi.fn(),
  product: vi.fn(),
  delivery: vi.fn(),
  checkout: vi.fn(),
  mutation: vi.fn(),
}));

vi.mock(
  '@/components/storefront/ogabassey/components/chat/chatwoot-inline-cart-controls',
  () => ({ postChatwootCanonicalCartView: mocks.cartView })
);
vi.mock(
  '@/components/storefront/ogabassey/components/chat/chatwoot-inline-product-lookup',
  () => ({ handleChatwootInlineProductLookup: mocks.product })
);
vi.mock('./chatwoot-delivery-options-action', () => ({
  handleChatwootDeliveryOptionsAction: mocks.delivery,
}));
vi.mock('./chatwoot-checkout-action', () => ({
  handleChatwootCheckoutAction: mocks.checkout,
}));
vi.mock('./chatwoot-inline-cart-mutation-dispatch', () => ({
  dispatchChatwootInlineCartMutation: mocks.mutation,
}));

import {
  type AuthorizedChatwootActionInput,
  dispatchChatwootAuthorizedAction,
} from './chatwoot-inline-authorized-action';

const snapshot = {
  cartVersion: 8,
  currency: 'NGN',
  estimatedTotals: false,
  items: [],
  itemsSubtotalMinor: 0,
};
const base = {
  sessionToken: 's',
  conversationId: 905,
  requestId: 'request-0001',
};

function input(message: unknown): AuthorizedChatwootActionInput {
  return {
    message,
    authorized: {
      cartId: 'cart-1',
      conversationId: 905,
      sessionExpiresAt: 1,
      snapshot,
    },
    actionSessionToken: 'session-905',
    conversationId: 905,
    requestId: 'request-0001',
    storeSlug: 'store',
    action: { canApplyRenewal: () => true, isCurrent: () => true },
    requestedCartRef: { cartId: 'cart-1', version: 8 },
    requestedMerchantSlug: 'store',
    lineTokens: new Map(),
    post: vi.fn(),
    postRawPayload: vi.fn(),
    getCartState: () => ({
      cart: [],
      sharedCartRef: { cartId: 'cart-1', version: 8 },
    }),
    getMerchant: () => ({ id: 'merchant-1', taxRate: 0 }),
    getSessionExpiresAt: () => Date.now() + 60_000,
    getAuthorizedSessionToken: () => 'renewed',
    hasSessionAlias: () => true,
    isCurrentTarget: () => true,
    onSessionTokenRenewed: vi.fn(),
  } as unknown as AuthorizedChatwootActionInput;
}

beforeEach(() => vi.clearAllMocks());

describe('dispatchChatwootAuthorizedAction', () => {
  it('answers a cart request from the authorized snapshot only', async () => {
    await dispatchChatwootAuthorizedAction(
      input({ event: 'baci-cart-request', data: base })
    );

    expect(mocks.cartView).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'request-0001', snapshot })
    );
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it('routes a product lookup, a delivery request and checkout messages to their handlers', async () => {
    await dispatchChatwootAuthorizedAction(
      input({ event: 'baci-product-request', data: { ...base, slug: 'phone' } })
    );
    await dispatchChatwootAuthorizedAction(
      input({
        event: 'baci-delivery-options-request',
        data: { ...base, state: 'Lagos' },
      })
    );
    const place = { event: 'baci-checkout-place-request', data: base };
    const status = {
      event: 'baci-checkout-payment-status-request',
      data: base,
    };
    await dispatchChatwootAuthorizedAction(input(place));
    await dispatchChatwootAuthorizedAction(input(status));

    expect(mocks.product).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'phone', sessionToken: 'session-905' })
    );
    expect(mocks.delivery).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'Lagos', authorizedCartId: 'cart-1' })
    );
    expect(mocks.checkout).toHaveBeenCalledTimes(2);
    expect(mocks.checkout.mock.calls[0]?.[0]).toMatchObject({
      message: place,
      storeSlug: 'store',
      authorizedCartId: 'cart-1',
    });
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it('sends cart mutations to the mutation dispatcher with the live session token', async () => {
    await dispatchChatwootAuthorizedAction(
      input({ event: 'baci-cart-quantity', data: base })
    );

    expect(mocks.mutation).toHaveBeenCalledTimes(1);
    const call = mocks.mutation.mock.calls[0]?.[0] as {
      getSessionToken: () => string;
    };
    expect(call.getSessionToken()).toBe('renewed');
  });
});
