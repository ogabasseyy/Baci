import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ authorize: vi.fn() }));

vi.mock(
  '@/components/storefront/ogabassey/components/chat/chatwoot-bridge-session',
  () => ({ authorizeChatwootBridgeSession: mocks.authorize })
);

import { authorizeCurrentChatwootInlineAction } from './chatwoot-inline-action-authorization';

const authorized = {
  conversationId: 905,
  snapshot: { cartVersion: 8 },
};

beforeEach(() => vi.clearAllMocks());

describe('authorizeCurrentChatwootInlineAction', () => {
  it('accepts only the same session action and cart version', async () => {
    mocks.authorize.mockResolvedValue(authorized);

    const result = await authorizeCurrentChatwootInlineAction({
      sessionToken: 'session-905',
      storeSlug: 'store',
      actionGeneration: 4,
      getLatestActionGeneration: () => 4,
      requestedCartRef: { cartId: 'cart-1', version: 8 },
      getCurrentCartRef: () => ({ cartId: 'cart-1', version: 8 }),
    });

    expect(result).toEqual({ authorized, actionStillCurrent: true });
    expect(mocks.authorize).toHaveBeenCalledWith('session-905', 'store');
  });

  it('rejects a cart or action generation that changed during authorization', async () => {
    mocks.authorize.mockResolvedValue(authorized);

    const result = await authorizeCurrentChatwootInlineAction({
      sessionToken: 'session-905',
      storeSlug: 'store',
      actionGeneration: 4,
      getLatestActionGeneration: () => 5,
      requestedCartRef: { cartId: 'cart-1', version: 8 },
      getCurrentCartRef: () => ({ cartId: 'cart-1', version: 8 }),
    });

    expect(result.actionStillCurrent).toBe(false);
  });

  it('fails closed when authorization throws', async () => {
    mocks.authorize.mockRejectedValue(new Error('private session detail'));

    const result = await authorizeCurrentChatwootInlineAction({
      sessionToken: 'session-905',
      storeSlug: 'store',
      actionGeneration: 4,
      getLatestActionGeneration: () => 4,
      requestedCartRef: { cartId: 'cart-1', version: 8 },
      getCurrentCartRef: () => ({ cartId: 'cart-1', version: 8 }),
    });

    expect(result).toEqual({ authorized: null, actionStillCurrent: false });
  });
});
