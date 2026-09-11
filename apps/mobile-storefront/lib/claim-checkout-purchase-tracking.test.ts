import { claimCheckoutPurchaseTracking } from './claim-checkout-purchase-tracking';

it('tracks the first observed order id and ignores a later replay of the same order', () => {
  expect(claimCheckoutPurchaseTracking('order-1')).toBe(true);
  expect(claimCheckoutPurchaseTracking('order-1')).toBe(false);
  expect(claimCheckoutPurchaseTracking('order-2')).toBe(true);
});
