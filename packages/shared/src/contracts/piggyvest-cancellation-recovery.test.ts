import { expect, it } from 'vitest';
import { piggyvestCancellationRecoverySchemas as schemas } from './piggyvest-cancellation-recovery';

const goalId = '11111111-1111-4111-8111-111111111111';
const operationId = '22222222-2222-4222-8222-222222222222';
const common = {
  goalId,
  requestedOperationId: operationId,
  retry: 'not_authorized',
  dispatch: 'contract_gap',
};
const prepared = {
  ...common,
  status: 'prepared',
  operationId,
  reservation: 'retained',
  interestDisposition: 'unresolved',
  originalDisclosure: {
    revisionId: goalId,
    termsVersion: 'synthetic',
    termsHash: 'a'.repeat(64),
    consentVersion: '2026-09-11',
    principalKobo: 10000,
    paidInterestKobo: 10,
    pendingInterestKobo: 20,
  },
};
it('accepts read-only request with optional original operation', () => {
  expect(schemas.request.parse({ goalId })).toEqual({ goalId });
  expect(schemas.request.parse({ goalId, operationId })).toEqual({
    goalId,
    operationId,
  });
  expect(schemas.request.safeParse({ goalId, actorId: goalId }).success).toBe(
    false
  );
});
it.each([
  prepared,
  { ...common, status: 'absent', operationId: null, reservation: 'unknown' },
  {
    ...common,
    status: 'requires_reconciliation',
    operationId,
    reservation: 'unknown',
    interestDisposition: 'unresolved',
  },
  {
    ...common,
    status: 'unavailable',
    operationId: null,
    reservation: 'may_be_retained',
  },
])('preserves safe read-only state %j', (value) => {
  expect(schemas.response.parse(value)).toEqual(value);
  expect(
    schemas.response.safeParse({ ...value, retry: 'allowed' }).success
  ).toBe(false);
  expect(schemas.response.safeParse({ ...value, refunded: true }).success).toBe(
    false
  );
});
it('rejects operation mismatches and private disclosure fields', () => {
  expect(
    schemas.response.safeParse({ ...prepared, operationId: goalId }).success
  ).toBe(false);
  expect(
    schemas.response.safeParse({
      ...prepared,
      originalDisclosure: { ...prepared.originalDisclosure, actorId: goalId },
    }).success
  ).toBe(false);
  expect(
    schemas.response.safeParse({
      ...prepared,
      originalDisclosure: { ...prepared.originalDisclosure, principalKobo: 0 },
    }).success
  ).toBe(false);
});
