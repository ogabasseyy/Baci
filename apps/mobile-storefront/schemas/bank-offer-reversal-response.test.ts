import { expect, it } from '@jest/globals';
import { bankOfferReversalResponseSchema } from './bank-offer-reversal-response';

const envelope = {
  orderId: 'order-1',
  status: 'reversed',
  success: false,
  reference: `BCO-${'a'.repeat(32)}`,
};

it('accepts a reversal response with additive metadata', () => {
  expect(
    bankOfferReversalResponseSchema.parse({
      ...envelope,
      orderNumber: 'OG-1',
    })
  ).toEqual(envelope);
});

it.each([
  { finalizationOutcome: 'completed' },
  { success: true },
  { reference: undefined },
])('rejects contradictory or unbound reversal data %j', (changes) => {
  expect(
    bankOfferReversalResponseSchema.safeParse({ ...envelope, ...changes })
      .success
  ).toBe(false);
});
