import { describe, expect, it } from 'vitest';
import {
  createChatwootActionGenerations,
  evaluateChatwootActionCartFreshness,
} from './chatwoot-inline-action-state';

describe('createChatwootActionGenerations', () => {
  it('lets a newer cart action supersede an older one', () => {
    const generations = createChatwootActionGenerations();
    const first = generations.startAction(false);
    const second = generations.startAction(false);
    expect(first.isCurrent()).toBe(false);
    expect(second.isCurrent()).toBe(true);
  });

  it('keeps overlapping product lookups independently current', () => {
    const generations = createChatwootActionGenerations();
    const first = generations.startAction(true);
    const second = generations.startAction(true);
    generations.startAction(false);
    expect(first.isCurrent()).toBe(true);
    expect(second.isCurrent()).toBe(true);
  });

  it('does not let a product lookup supersede a pending cart action', () => {
    const generations = createChatwootActionGenerations();
    const cart = generations.startAction(false);
    generations.startAction(true);
    expect(cart.isCurrent()).toBe(true);
  });

  it('invalidates every action when a new context begins', () => {
    const generations = createChatwootActionGenerations();
    const product = generations.startAction(true);
    const cart = generations.startAction(false);
    generations.beginContext();
    expect(product.isCurrent()).toBe(false);
    expect(cart.isCurrent()).toBe(false);
  });
});

describe('evaluateChatwootActionCartFreshness', () => {
  const ref = (version: number) => ({ cartId: 'c1', version });
  const run = (
    event: string,
    authorizedVersion: number | null,
    requested: ReturnType<typeof ref> | null,
    current: ReturnType<typeof ref> | null
  ) =>
    evaluateChatwootActionCartFreshness({
      authorizedVersion,
      currentCartRef: current,
      event,
      requestedCartRef: requested,
    });

  it('requires an exact version for read-only cart views', () => {
    expect(run('baci-cart-request', 3, ref(3), ref(3))).toMatchObject({
      authorizedVersionIsCurrent: true,
      cartRefIsCurrent: true,
    });
    expect(run('baci-cart-request', 3, ref(3), ref(4))).toMatchObject({
      authorizedVersionIsCurrent: false,
      cartRefIsCurrent: false,
    });
    expect(
      run('baci-cart-request', null, ref(3), ref(3)).authorizedVersionIsCurrent
    ).toBe(false);
  });

  it('lets mutations proceed when the server is at or ahead of the local cart', () => {
    expect(run('baci-cart-add', 5, ref(3), ref(4))).toMatchObject({
      authorizedVersionIsCurrent: true,
      cartRefIsCurrent: true,
    });
    expect(
      run('baci-cart-quantity', 3, ref(3), ref(4)).authorizedVersionIsCurrent
    ).toBe(false);
    expect(run('baci-cart-quantity', 3, ref(3), ref(4)).cartRefIsCurrent).toBe(
      false
    );
  });

  it('accepts a product lookup while the cart moved forward within bounds', () => {
    expect(run('baci-product-request', 4, ref(3), ref(4))).toMatchObject({
      authorizedVersionIsCurrent: true,
      cartRefIsCurrent: true,
    });
    expect(
      run('baci-product-request', 2, ref(3), ref(4)).authorizedVersionIsCurrent
    ).toBe(false);
    expect(
      run('baci-product-request', 5, ref(3), ref(4)).authorizedVersionIsCurrent
    ).toBe(false);
  });

  it('rejects a different cart or a missing requested cart', () => {
    expect(
      run('baci-cart-add', 5, ref(3), { cartId: 'c2', version: 5 })
        .cartRefIsCurrent
    ).toBe(false);
    expect(run('baci-cart-add', 5, null, ref(5)).cartRefIsCurrent).toBe(false);
  });
});
