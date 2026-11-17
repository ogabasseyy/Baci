import { beforeEach, describe, expect, it, vi } from 'vitest';

const authorizeMock = vi.hoisted(() => vi.fn());
vi.mock(
  '@/components/storefront/ogabassey/components/chat/chatwoot-bridge-session',
  () => ({ authorizeChatwootBridgeSession: authorizeMock })
);

import { authorizeChatwootInlineCartAction } from './chatwoot-inline-cart-action-authorization';

const ref = { cartId: 'cart-1', version: 8 };

function authorized(overrides: Record<string, unknown> = {}) {
  return {
    conversationId: 905,
    cartId: 'cart-1',
    sessionExpiresAt: 9_999_999_999,
    snapshot: { cartVersion: 8 },
    ...overrides,
  };
}

function run(overrides: Record<string, unknown> = {}) {
  const onSessionTokenRenewed = vi.fn();
  const tokenAliases = new Set<string>(['session-1']);
  const result = authorizeChatwootInlineCartAction({
    isQuantityEdit: false,
    sessionToken: 'session-1',
    storeSlug: 'ogabassey',
    actionGeneration: 1,
    getLatestActionGeneration: () => 1,
    isMessageTokenKnown: () => true,
    tokenAliases,
    initialSessionToken: 'session-1',
    requestedCartRef: ref,
    getCurrentCartRef: () => ref,
    onSessionTokenRenewed,
    ...overrides,
  });
  return { result, onSessionTokenRenewed, tokenAliases };
}

describe('authorizeChatwootInlineCartAction', () => {
  beforeEach(() => {
    authorizeMock.mockReset();
  });

  it('reports the action as current when cart, version and id still match', async () => {
    authorizeMock.mockResolvedValue(authorized());
    const { result } = run();
    await expect(result).resolves.toMatchObject({ actionStillCurrent: true });
  });

  it('rejects an action authorized for a different cart id', async () => {
    authorizeMock.mockResolvedValue(authorized({ cartId: 'other-cart' }));
    const { result } = run();
    await expect(result).resolves.toMatchObject({ actionStillCurrent: false });
  });

  it('rejects a non-quantity action when the snapshot version is behind', async () => {
    authorizeMock.mockResolvedValue(
      authorized({ snapshot: { cartVersion: 7 } })
    );
    const { result } = run();
    await expect(result).resolves.toMatchObject({ actionStillCurrent: false });
  });

  it('allows a quantity edit whose snapshot is at or ahead of the cart', async () => {
    authorizeMock.mockResolvedValue(
      authorized({ snapshot: { cartVersion: 9 } })
    );
    const { result } = run({ isQuantityEdit: true });
    await expect(result).resolves.toMatchObject({ actionStillCurrent: true });
  });

  it('treats an authorize failure as not current', async () => {
    authorizeMock.mockImplementation(() => {
      throw new Error('network');
    });
    const { result } = run();
    await expect(result).resolves.toMatchObject({
      authorized: null,
      actionStillCurrent: false,
    });
  });

  it('reports a renewed session token and uses it for the action', async () => {
    authorizeMock.mockResolvedValue(authorized({ sessionToken: 'session-2' }));
    const { result, onSessionTokenRenewed, tokenAliases } = run();
    await expect(result).resolves.toMatchObject({
      actionSessionToken: 'session-2',
    });
    expect(onSessionTokenRenewed).toHaveBeenCalledWith('session-2');
    expect(tokenAliases.has('session-2')).toBe(true);
  });

  it('ignores a renewed token when a newer action has superseded this one', async () => {
    authorizeMock.mockResolvedValue(authorized({ sessionToken: 'session-2' }));
    const { result, onSessionTokenRenewed } = run({
      getLatestActionGeneration: () => 2,
    });
    await expect(result).resolves.toMatchObject({
      actionSessionToken: 'session-1',
      actionStillCurrent: false,
    });
    expect(onSessionTokenRenewed).not.toHaveBeenCalled();
  });
});
