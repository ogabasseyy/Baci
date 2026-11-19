import { expect, it } from 'vitest';
import { socialCapiEventSchema } from './social-capi-event';

const input = {
  event: 'view_item',
  merchantId: '11111111-1111-4111-8111-111111111111',
  consent: true,
  eventData: {
    value: 0,
    currency: 'NGN',
    products: [{ id: 'one', name: 'Phone', quantity: 1, price: 0 }],
  },
};
it.each([
  'view_item',
  'add_to_cart',
  'begin_checkout',
])('accepts bounded zero-value observations for %s', (event) => {
  expect(socialCapiEventSchema.safeParse({ ...input, event }).success).toBe(
    true
  );
});
it.each([
  { event: 'purchase' },
  { consent: false },
  { merchantId: 'not-uuid' },
  { eventData: { ...input.eventData, products: [] } },
  { eventData: { ...input.eventData, value: Number.POSITIVE_INFINITY } },
])('rejects untrusted or invalid observation %j', (change) => {
  expect(socialCapiEventSchema.safeParse({ ...input, ...change }).success).toBe(
    false
  );
});
