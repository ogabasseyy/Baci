import { describe, expect, it } from 'vitest';
import { evaluateChatwootActionCartFreshness } from './chatwoot-action-cart-freshness';

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
