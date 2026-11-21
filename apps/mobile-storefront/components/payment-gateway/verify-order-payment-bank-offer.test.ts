import { expect, it, jest } from '@jest/globals';
import { verifyOrderPaymentForCompletion } from './verify-order-payment';
import { checkReferenceSettled } from './verify-order-payment-reference-settlement';
import { checkTrackedOrderPaid } from './verify-order-payment-tracked-lookup';

jest.mock('./verify-order-payment-reference-settlement', () => ({
  checkReferenceSettled: jest.fn(),
}));
jest.mock('./verify-order-payment-tracked-lookup', () => ({
  checkTrackedOrderPaid: jest.fn(),
}));

it('requires provider evidence for a bank offer even when the tracked order is paid', async () => {
  jest.mocked(checkTrackedOrderPaid).mockResolvedValueOnce({ paid: true });
  jest.mocked(checkReferenceSettled).mockResolvedValueOnce({
    paid: false,
    inconclusive: true,
  });

  await expect(
    verifyOrderPaymentForCompletion({
      orderId: 'order-1',
      trackingToken: 'track-1',
      reference: `BCO-${'a'.repeat(32)}`,
    })
  ).resolves.toEqual({ paid: false, inconclusive: true });
});

it('prefers a provider-confirmed reversal over generic tracked reconciliation', async () => {
  jest.mocked(checkTrackedOrderPaid).mockResolvedValueOnce({
    paid: false,
    reconciliation: 'order_cancelled',
  });
  jest.mocked(checkReferenceSettled).mockResolvedValueOnce({
    paid: false,
    reconciliation: 'payment_reversed',
  });

  await expect(
    verifyOrderPaymentForCompletion({
      orderId: 'order-1',
      trackingToken: 'track-1',
      reference: `BCO-${'a'.repeat(32)}`,
    })
  ).resolves.toEqual({ paid: false, reconciliation: 'payment_reversed' });
});
