import { expect, it } from 'vitest';
import { piggyvestCustomerPurchaseHandlerSchemas as schemas } from './piggyvest-customer-purchase-handler';

const uuid = '30000000-0000-4000-8000-00000000000a';
const input = {
  goalId: uuid,
  quoteId: uuid,
  shippingRateId: uuid,
  savingsKobo: 1,
  fulfilmentMode: 'pickup',
};
it('requires explicit pickup identity and canonical UUIDs', () => {
  expect(
    schemas.quote.parse({ ...input, goalId: uuid.toUpperCase() }).goalId
  ).toBe(uuid);
});
it.each([
  { fulfilmentMode: undefined },
  { fulfilmentMode: 'ship' },
  { deliveryKobo: 0 },
  { actorId: uuid },
  { savingsKobo: 0 },
  { savingsKobo: 1.5 },
])('rejects unsupported authority %j', (extra) => {
  expect(schemas.quote.safeParse({ ...input, ...extra }).success).toBe(false);
});
it('requires exact operation and goal with no extra queries', () => {
  expect(schemas.status.safeParse({ goalId: uuid }).success).toBe(false);
  expect(
    schemas.status.safeParse({ goalId: uuid, operationId: uuid, actorId: uuid })
      .success
  ).toBe(false);
  expect(
    schemas.status.safeParse({ goalId: uuid, operationId: uuid }).success
  ).toBe(true);
});
