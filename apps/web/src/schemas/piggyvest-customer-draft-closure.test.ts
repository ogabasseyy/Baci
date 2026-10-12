import { expect, it } from 'vitest';
import { piggyvestCustomerDraftClosureSchemas as schemas } from './piggyvest-customer-draft-closure';

const goalId = '30000000-0000-4000-8000-000000000801';
const command = {
  goalId,
  operationId: goalId,
  revisionId: goalId,
  termsVersion: 'synthetic-v1',
  termsHash: 'a'.repeat(64),
  accepted: true,
};
it('requires explicit strict closure consent without financial or actor authority', () => {
  expect(schemas.close.parse(command)).toEqual(command);
  for (const extra of [
    { accepted: false },
    { actorId: goalId },
    { refundKobo: 0 },
    { providerZero: true },
  ]) {
    expect(schemas.close.safeParse({ ...command, ...extra }).success).toBe(
      false
    );
  }
});
it('distinguishes reconciliation from a closure receipt', () => {
  const blocked = {
    status: 'requires_reconciliation',
    goalId,
    reason: 'provider_zero_unverified',
  };
  expect(schemas.response.parse(blocked)).toEqual(blocked);
  expect(
    schemas.response.safeParse({ ...blocked, refunded: true }).success
  ).toBe(false);
  expect(schemas.response.safeParse({ status: 'closed', goalId }).success).toBe(
    false
  );
});
