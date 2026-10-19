import { expect, it } from 'vitest';
import { piggyvestDraftClosureSchemas as schemas } from './piggyvest-draft-closure';

const goalId = 'abcdefab-0000-4000-8000-000000000816';
const command = {
  goalId,
  revisionId: goalId,
  operationId: goalId,
  termsVersion: 'synthetic-v1',
  termsHash: 'a'.repeat(64),
  accepted: true,
};
it('accepts the existing strict public closure protocol', () => {
  expect(schemas.close.parse(command)).toEqual(command);
  expect(
    schemas.response.parse({
      status: 'requires_reconciliation',
      goalId,
      reason: 'provider_zero_unverified',
    }).status
  ).toBe('requires_reconciliation');
});
it.each([
  'actorId',
  'integrationId',
  'providerWalletId',
  'providerEmpty',
  'balanceKobo',
])('rejects authority field %s', (field) => {
  expect(schemas.close.safeParse({ ...command, [field]: true }).success).toBe(
    false
  );
});
it('rejects false consent and refund claims', () => {
  expect(schemas.close.safeParse({ ...command, accepted: false }).success).toBe(
    false
  );
  expect(
    schemas.response.safeParse({
      status: 'closed',
      goalId,
      revisionId: goalId,
      termsVersion: command.termsVersion,
      termsHash: command.termsHash,
      operationId: goalId,
      closedAt: '2026-09-12T00:00:00Z',
      action: 'close_plan',
      refundIssued: true,
      providerWalletDeleted: false,
    }).success
  ).toBe(false);
});
