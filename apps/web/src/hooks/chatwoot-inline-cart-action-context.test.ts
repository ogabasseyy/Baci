import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChatwootInlineActionContext } from './chatwoot-inline-cart-action-context';

function build(overrides: Record<string, unknown> = {}) {
  const state = {
    alias: true,
    cart: {
      merchantSlug: 'shop',
      sharedCartRef: { cartId: 'c1', version: 3 } as {
        cartId: string;
        version: number;
      } | null,
    },
    expiresAt: Date.now() + 60_000,
    generation: 1,
    target: true,
  };
  const renewed = vi.fn();
  const context = createChatwootInlineActionContext({
    getCartState: () => state.cart,
    isCurrentGeneration: () => state.generation === 1,
    getSessionExpiresAt: () => state.expiresAt,
    hasSessionAlias: () => state.alias,
    isCurrentTarget: () => state.target,
    onSessionTokenRenewed: renewed,
    requestedCartRef: { cartId: 'c1', version: 3 },
    requestedMerchantSlug: 'shop',
    ...overrides,
  });
  return { context, renewed, state };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createChatwootInlineActionContext', () => {
  it('reports a live action as current', () => {
    const { context } = build();
    expect(context.isCurrentAction()).toBe(true);
    expect(context.isCurrentCartContext()).toBe(true);
    expect(context.isCurrentContext()).toBe(true);
  });

  it('stops the action when a newer action started', () => {
    const { context, state } = build();
    state.generation = 2;
    expect(context.isCurrentAction()).toBe(false);
  });

  it('stops the action when the frame target or session alias is gone', () => {
    const { context, state } = build();
    state.target = false;
    expect(context.isCurrentAction()).toBe(false);
    expect(context.isCurrentCartContext()).toBe(false);
    expect(context.isCurrentContext()).toBe(false);
    state.target = true;
    state.alias = false;
    expect(context.isCurrentAction()).toBe(false);
    expect(context.isCurrentContext()).toBe(false);
  });

  it('rejects the cart context after a merchant or cart change', () => {
    const { context, state } = build();
    state.cart = {
      merchantSlug: 'other',
      sharedCartRef: state.cart.sharedCartRef,
    };
    expect(context.isCurrentCartContext()).toBe(false);
    state.cart = {
      merchantSlug: 'shop',
      sharedCartRef: { cartId: 'c2', version: 3 },
    };
    expect(context.isCurrentCartContext()).toBe(false);
    state.cart = { merchantSlug: 'shop', sharedCartRef: null };
    expect(context.isCurrentCartContext()).toBe(false);
  });

  it('rejects the cart context when the request had no cart', () => {
    const { context } = build({ requestedCartRef: null });
    expect(context.isCurrentCartContext()).toBe(false);
  });

  it('rejects the context after the session expires', () => {
    const { context, state } = build();
    state.expiresAt = Date.now() - 1;
    expect(context.isCurrentContext()).toBe(false);
  });

  it('forwards a renewed token only for the current action and alias', () => {
    const { context, renewed, state } = build();
    context.onSessionTokenRenewed('t1');
    expect(renewed).toHaveBeenCalledWith('t1');
    state.generation = 2;
    context.onSessionTokenRenewed('t2');
    state.generation = 1;
    state.alias = false;
    context.onSessionTokenRenewed('t3');
    expect(renewed).toHaveBeenCalledTimes(1);
  });

  it('keeps a product lookup current until its own context changes', () => {
    const { context, state } = build();
    expect(context.isCurrentLookup()).toBe(true);
    state.cart = { ...state.cart, merchantSlug: 'other' };
    expect(context.isCurrentLookup()).toBe(false);
    state.cart = { ...state.cart, merchantSlug: 'shop' };
    state.expiresAt = Date.now() - 1;
    expect(context.isCurrentLookup()).toBe(false);
    state.expiresAt = Date.now() + 60_000;
    state.generation = 2;
    expect(context.isCurrentLookup()).toBe(false);
  });
});
