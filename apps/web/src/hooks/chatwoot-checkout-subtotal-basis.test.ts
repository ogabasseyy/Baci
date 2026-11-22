import { describe, expect, it } from 'vitest';
import type { CartItem } from '@/hooks/cart';
import { isChatwootCheckoutSubtotalBasisEqual } from './chatwoot-checkout-subtotal-basis';
import { checkoutDisplayCart } from './chatwoot-checkout-test-fixtures';

const line = (overrides: Record<string, unknown>) =>
  [{ ...checkoutDisplayCart[0], ...overrides }] as unknown as CartItem[];

describe('isChatwootCheckoutSubtotalBasisEqual', () => {
  it('is true when the cart subtotal equals the catalog basis', () => {
    expect(
      isChatwootCheckoutSubtotalBasisEqual(checkoutDisplayCart, 200_000)
    ).toBe(true);
  });

  it('is false for a different subtotal', () => {
    expect(
      isChatwootCheckoutSubtotalBasisEqual(checkoutDisplayCart, 180_000)
    ).toBe(false);
  });

  it('is false for an accepted negotiated price (cart 1800, catalog 2000)', () => {
    const cart = line({
      negotiatedPrice: 900,
      negotiationStatus: 'accepted',
      catalogPrice: 1000,
    });
    expect(isChatwootCheckoutSubtotalBasisEqual(cart, 180_000)).toBe(false);
  });

  it('is false for an assurance line (catalog adds the fee the cart subtotal omits)', () => {
    expect(
      isChatwootCheckoutSubtotalBasisEqual(
        line({ hasAssurance: true }),
        200_000
      )
    ).toBe(false);
  });
});
