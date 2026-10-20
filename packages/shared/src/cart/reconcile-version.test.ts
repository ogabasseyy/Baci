import { describe, expect, it } from 'vitest';
import { readCartChangeEvent, shouldRefreshCart } from './reconcile-version';

const event = {
  merchantId: 'merchant-a',
  cartId: 'cart-a',
  version: 3,
  operationId: 'op-3',
};
describe('cart change reconciliation', () => {
  it('refreshes only for a newer committed version', () => {
    expect(shouldRefreshCart(2, event)).toBe(true);
    expect(shouldRefreshCart(3, event)).toBe(false);
    expect(shouldRefreshCart(4, event)).toBe(false);
  });
  it('ignores another cart or merchant even when its version is newer', () => {
    const identity = { merchantId: 'merchant-a', cartId: 'cart-a' };
    expect(
      shouldRefreshCart(2, { ...event, merchantId: 'merchant-b' }, identity)
    ).toBe(false);
    expect(shouldRefreshCart(2, { ...event, cartId: 'cart-b' }, identity)).toBe(
      false
    );
    expect(shouldRefreshCart(2, event, identity)).toBe(true);
  });
  it.each([
    null,
    {},
    { ...event, version: 0 },
    { ...event, version: Number.NaN },
    { ...event, version: 2.5 },
    { ...event, version: Number.MAX_SAFE_INTEGER + 1 },
    { ...event, cartId: '' },
    { ...event, operationId: 'a'.repeat(129) },
  ])('rejects malformed events: %j', (input) => {
    expect(readCartChangeEvent(input)).toBeNull();
  });
  it('projects only credential-free notification fields', () => {
    expect(readCartChangeEvent({ ...event, token: 'must-not-escape' })).toEqual(
      event
    );
  });
});
