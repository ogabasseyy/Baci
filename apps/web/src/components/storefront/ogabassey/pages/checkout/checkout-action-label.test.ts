import { expect, it } from 'vitest';
import { getCheckoutActionLabel } from './checkout-action-label';

it('uses the installment handoff label before provider-specific payment actions', () => {
  expect(getCheckoutActionLabel('installments', 'oxygen')).toBe('Begin Process');
  expect(getCheckoutActionLabel('installments', 'invoice')).toBe('Begin Process');
});

it('describes invoice, shared payment and ordinary checkout actions', () => {
  expect(getCheckoutActionLabel('full', 'invoice')).toBe('Generate Invoice');
  expect(getCheckoutActionLabel('full', 'payforme')).toBe('Send Payment Link');
  expect(getCheckoutActionLabel('full', 'paystack')).toBe('Place Order');
});
