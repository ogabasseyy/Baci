import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ postChatwootBridgeJson: vi.fn() }));

vi.mock(
  '@/components/storefront/ogabassey/components/chat/chatwoot-bridge-request',
  () => ({ postChatwootBridgeJson: mocks.postChatwootBridgeJson })
);

import { handleChatwootDeliveryOptionsAction } from './chatwoot-delivery-options-action';

type DeliveryActionInput = Parameters<
  typeof handleChatwootDeliveryOptionsAction
>[0];

const snapshot = {
  cartVersion: 8,
  currency: 'NGN',
  estimatedTotals: false,
  itemsSubtotalMinor: 250_000,
};
const cartRef = { cartId: 'cart-1', version: 8 };
const estimate = {
  state: 'Lagos',
  cartVersion: 8,
  currency: 'NGN',
  subtotalMinor: 250_000,
  options: [
    {
      displayName: 'Merchant delivery',
      priceMajor: 2500,
      currency: 'NGN',
      pickup: false,
    },
  ],
};

function input(
  overrides: Partial<DeliveryActionInput> = {}
): DeliveryActionInput {
  return {
    requestId: 'delivery-0001',
    conversationId: 905,
    sessionToken: 'session-905',
    state: 'Lagos',
    storeSlug: 'store',
    snapshot,
    requestedCartRef: cartRef,
    getCurrentCartRef: () => cartRef,
    isCurrent: () => true,
    postResult: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('handleChatwootDeliveryOptionsAction', () => {
  it('requests options for the authorized cart version and returns the validated estimate', async () => {
    mocks.postChatwootBridgeJson.mockResolvedValue(estimate);
    const action = input();

    await handleChatwootDeliveryOptionsAction(action);

    expect(mocks.postChatwootBridgeJson).toHaveBeenCalledWith(
      '/api/storefront/chatwoot/context/delivery-options',
      {
        sessionToken: 'session-905',
        conversationId: 905,
        expectedCartVersion: 8,
        state: 'Lagos',
      },
      'store'
    );
    expect(action.postResult).toHaveBeenCalledWith({
      requestId: 'delivery-0001',
      status: 'ready',
      ...estimate,
    });
  });

  it('returns unavailable when the cart changes while rates are loading', async () => {
    mocks.postChatwootBridgeJson.mockResolvedValue(estimate);
    const action = input({
      getCurrentCartRef: () => ({ cartId: 'cart-1', version: 9 }),
    });

    await handleChatwootDeliveryOptionsAction(action);

    expect(action.postResult).toHaveBeenCalledWith({
      requestId: 'delivery-0001',
      status: 'unavailable',
    });
  });

  it('does not post a response after the authorized action context changes', async () => {
    mocks.postChatwootBridgeJson.mockResolvedValue(estimate);
    const action = input({ isCurrent: () => false });

    await handleChatwootDeliveryOptionsAction(action);

    expect(action.postResult).not.toHaveBeenCalled();
  });

  it('fails closed when the cart total was estimated or the response does not match it', async () => {
    const estimatedCartAction = input({
      snapshot: { ...snapshot, estimatedTotals: true },
    });
    await handleChatwootDeliveryOptionsAction(estimatedCartAction);
    expect(mocks.postChatwootBridgeJson).not.toHaveBeenCalled();

    mocks.postChatwootBridgeJson.mockResolvedValue({
      ...estimate,
      subtotalMinor: 1,
    });
    const mismatchedResponseAction = input();
    await handleChatwootDeliveryOptionsAction(mismatchedResponseAction);
    expect(mismatchedResponseAction.postResult).toHaveBeenCalledWith({
      requestId: 'delivery-0001',
      status: 'unavailable',
    });
  });
});
