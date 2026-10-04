import { expect, it } from 'vitest';
import { piggyvestCustomerPeriodRecoverySchemas as schemas } from './piggyvest-customer-period-recovery';

const identity = {
  goalId: '30000000-0000-4000-8000-000000000001',
  ledgerOperationId: 'b0000000-0000-4000-8000-000000000001',
};
it('requires both canonical identities and rejects caller authority', () => {
  expect(schemas.selection.parse(identity)).toEqual(identity);
  expect(schemas.selection.safeParse({ goalId: identity.goalId }).success).toBe(
    false
  );
  expect(
    schemas.selection.safeParse({ ...identity, amountKobo: 1 }).success
  ).toBe(false);
});
it('keeps public metadata non-authorizing and excludes private identifiers', () => {
  const response = {
    ...identity,
    metadataRecorded: true,
    kind: 'record_pending_interest',
    originalCreditKobo: 30,
    reversed: false,
    evidence: 'internal_ledger_only',
    periodStatus: 'unknown',
    coveredPeriod: null,
    entitlement: 'unresolved',
    disposition: 'unresolved',
    financialEffects: 'UNKNOWN',
    fundsUse: 'not_authorized',
  };
  expect(schemas.response.parse(response)).toEqual(response);
  for (const extra of [
    { evidenceId: 'private' },
    { actorId: identity.goalId },
    { fundsUse: 'authorized' },
    { coveredPeriod: 'September' },
    { originalCreditKobo: -1 },
  ]) {
    expect(schemas.response.safeParse({ ...response, ...extra }).success).toBe(
      false
    );
  }
});
