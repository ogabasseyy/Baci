import { expect, it } from 'vitest';
import { piggyvestCustomerCancelHandlerSchemas as schemas } from './piggyvest-customer-cancel-handler';

const goalId = 'abcdefab-4444-4444-8444-444444444444';
it('canonicalizes fixed goal and actor identity without accepting body authority', () => {
  expect(schemas.read.parse({ goalId: goalId.toUpperCase() })).toEqual({
    goalId,
  });
  expect(schemas.actor.parse({ id: goalId.toUpperCase() })).toEqual({
    id: goalId,
  });
  expect(schemas.read.safeParse({ goalId, actorId: goalId }).success).toBe(
    false
  );
  expect(schemas.read.safeParse({ goalId: 'bad' }).success).toBe(false);
});
it('requires reservation uncertainty and correlation rather than claiming a refund', () => {
  const receipt = {
    status: 'unavailable',
    goalId,
    operationId: goalId,
    reservation: 'may_be_retained',
    dispatch: 'contract_gap',
  };
  expect(schemas.receipt.parse(receipt)).toEqual(receipt);
  expect(
    schemas.receipt.safeParse({ ...receipt, refunded: true }).success
  ).toBe(false);
  expect(
    schemas.receipt.safeParse({ ...receipt, reservation: 'released' }).success
  ).toBe(false);
});
it('rejects financial effects and extra fields in quote projection', () => {
  expect(schemas.quote.parse({ status: 'unavailable', goalId })).toEqual({
    status: 'unavailable',
    goalId,
  });
  expect(
    schemas.quote.safeParse({ status: 'unavailable', goalId, balance: 100 })
      .success
  ).toBe(false);
});
