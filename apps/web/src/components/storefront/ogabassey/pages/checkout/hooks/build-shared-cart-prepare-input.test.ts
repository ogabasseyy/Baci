import { describe, expect, it } from 'vitest';
import { buildSharedCartPrepareInput } from './build-shared-cart-prepare-input';

describe('shared cart checkout preparation', () => {
  it('requests a recovery proof for the UBA review with the current cart version', () => {
    const input = buildSharedCartPrepareInput(
      { cartId: 'cart-1', version: 7 },
      'uba_redvault'
    );
    expect(input).toMatchObject({
      cartId: 'cart-1',
      expectedVersion: 7,
      recoveryForRedvault: true,
    });
    expect(input.operationId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('does not request a UBA recovery proof for another payment method', () => {
    const input = buildSharedCartPrepareInput(
      { cartId: 'cart-1', version: 7 },
      'paystack'
    );
    expect(input).not.toHaveProperty('recoveryForRedvault');
  });
});
