import { expect, it } from 'vitest';
import { piggyvestCustomerLifecycleHandlerSchemas as schemas } from './piggyvest-customer-lifecycle-handler';

const uuid = '30000000-0000-4000-8000-000000000001';
it.each([1, 6])('accepts explicit supported duration %s', (durationMonths) => {
  expect(
    schemas.terms.safeParse({ goalId: uuid, revisionId: uuid, durationMonths })
      .success
  ).toBe(true);
});
it.each([
  undefined,
  0,
  7,
  1.5,
  '1',
])('rejects missing or fabricated duration %s', (durationMonths) => {
  expect(
    schemas.terms.safeParse({ goalId: uuid, revisionId: uuid, durationMonths })
      .success
  ).toBe(false);
});
it('rejects browser balances and actor authority for activation', () => {
  const input = { goalId: uuid, revisionId: uuid, operationId: uuid };
  expect(schemas.activate.safeParse(input).success).toBe(true);
  expect(
    schemas.activate.safeParse({ ...input, principalKobo: 5001 }).success
  ).toBe(false);
  expect(schemas.activate.safeParse({ ...input, actorId: uuid }).success).toBe(
    false
  );
});
