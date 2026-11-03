import { describe, expect, it } from 'vitest';
import { facebookCapiEventSchema } from './facebook-capi-event';

const observation = {
  event: 'ViewContent',
  consent: true,
  merchantId: '11111111-1111-4111-8111-111111111111',
  eventData: {
    value: 0,
    currency: 'NGN',
    products: [{ id: 'phone', name: 'Phone', price: 0, quantity: 1 }],
  },
};
describe('public Meta observation contract', () => {
  it('accepts a zero-price view without treating it as a paid purchase', () => {
    expect(facebookCapiEventSchema.safeParse(observation).success).toBe(true);
    expect(
      facebookCapiEventSchema.safeParse({ ...observation, event: 'Purchase' })
        .success
    ).toBe(false);
  });
  it.each([
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])('rejects an invalid monetary value', (value) => {
    expect(
      facebookCapiEventSchema.safeParse({
        ...observation,
        eventData: { ...observation.eventData, value },
      }).success
    ).toBe(false);
  });
});
