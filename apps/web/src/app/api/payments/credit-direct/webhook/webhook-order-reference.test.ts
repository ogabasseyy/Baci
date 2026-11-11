import { expect, it } from 'vitest';
import { findCreditDirectWebhookOrder } from './webhook-order-reference';

it('rejects duplicate active references even with a signed order ID', () => {
  const orders = ['first', 'second'].map((id) => ({
    id,
    payment_method: 'credit_direct',
    notes: JSON.stringify({ creditDirectTransactionId: 'reference' }),
  }));
  expect(
    findCreditDirectWebhookOrder(orders, 'reference', undefined)
  ).toBeNull();
  expect(
    findCreditDirectWebhookOrder(orders, 'reference', 'second')
  ).toBeNull();
});

it('ignores text-only hits and superseded signed sessions', () => {
  const orders = [
    { id: 'note', payment_method: 'credit_direct', notes: 'reference' },
    {
      id: 'session',
      payment_method: 'credit_direct',
      notes: JSON.stringify({
        creditDirectSessionId: 'reference',
        creditDirectTransactionId: 'active-popup',
      }),
    },
  ];
  expect(
    findCreditDirectWebhookOrder(orders, 'reference', undefined)
  ).toBeUndefined();
});

it('selects the active Credit Direct order and ignores retired Klump with the same reference', () => {
  const active = {
    id: 'current',
    payment_method: 'credit_direct',
    notes: JSON.stringify({ creditDirectSessionId: 'reference' }),
  };
  const retired = { ...active, id: 'retired', payment_method: 'klump' };
  expect(
    findCreditDirectWebhookOrder([retired, active], 'reference', undefined)
  ).toBe(active);
  expect(
    findCreditDirectWebhookOrder([retired], 'reference', 'missing')
  ).toBeUndefined();
});
