import { expect, it } from 'vitest';
import { normalizeOrderPaymentMethod } from './normalize-order-payment-method';

it('preserves Oxygen identity when creating its order', () => {
  expect(normalizeOrderPaymentMethod('oxygen')).toBe('oxygen');
});
it('preserves the existing card and pay-on-delivery mappings', () => {
  expect(normalizeOrderPaymentMethod('paystack')).toBe('card');
  expect(normalizeOrderPaymentMethod('korapay')).toBe('card');
  expect(normalizeOrderPaymentMethod('pod')).toBe('pod');
});
