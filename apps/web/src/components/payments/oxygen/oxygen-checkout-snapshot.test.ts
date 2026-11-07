import { beforeEach, expect, it } from 'vitest';
import {
  captureOxygenCheckoutSnapshot,
  readOxygenCheckoutSnapshot,
} from './oxygen-checkout-snapshot';

beforeEach(() => sessionStorage.clear());
it('keeps the first order snapshot when the cart later changes', () => {
  captureOxygenCheckoutSnapshot('order', 'merchant', [
    { cartItemId: 'a', cartLineInstanceId: 'first', quantity: 1 },
  ]);
  captureOxygenCheckoutSnapshot('order', 'merchant', [
    { cartItemId: 'b', cartLineInstanceId: 'later', quantity: 1 },
  ]);
  expect(readOxygenCheckoutSnapshot('order', 'merchant')?.lines).toEqual([
    { cartItemId: 'a', instanceId: 'first', quantity: 1 },
  ]);
  expect(readOxygenCheckoutSnapshot('order', 'other')).toBeNull();
});
it('does not capture shared-cart identities or invent identities for old local lines', () => {
  captureOxygenCheckoutSnapshot('shared', 'merchant', [
    {
      cartItemId: 'a',
      cartLineInstanceId: 'x',
      quantity: 1,
      serverLineId: 'server',
    },
  ]);
  expect(readOxygenCheckoutSnapshot('shared', 'merchant')).toBeNull();
  captureOxygenCheckoutSnapshot('legacy', 'merchant', [
    { cartItemId: 'a', quantity: 1 },
  ]);
  expect(readOxygenCheckoutSnapshot('legacy', 'merchant')?.lines).toEqual([]);
});
