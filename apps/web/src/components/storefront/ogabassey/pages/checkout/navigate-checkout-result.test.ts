import { expect, it, vi } from 'vitest';
import { navigateCheckoutResult } from './navigate-checkout-result';

it('loads an Oxygen checkout as a new document and keeps other routes client-side', () => {
  const client = vi.fn();
  const document = vi.fn();
  navigateCheckoutResult('/shop/checkout?oxygenOrderId=123', client, document);
  expect(document).toHaveBeenCalledWith('/shop/checkout?oxygenOrderId=123');
  expect(client).not.toHaveBeenCalled();
  navigateCheckoutResult('/shop/order-success?orderId=123', client, document);
  expect(client).toHaveBeenCalledWith('/shop/order-success?orderId=123');
});
