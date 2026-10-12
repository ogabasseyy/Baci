import { describe, expect, it } from 'vitest';
import { cancelPlanSchemas } from './cancel-plan';

const uuid = '00000000-0000-4000-8000-000000000000';
const termsHash = 'a'.repeat(64);

describe('cancelPlanSchemas', () => {
  it('accepts a valid cancellation confirmation', () => {
    expect(
      cancelPlanSchemas.confirmation.safeParse({
        operationId: uuid,
        actorId: uuid,
        revisionId: uuid,
        termsVersion: 'v1',
        termsHash,
        consentVersion: '2026-09-11',
        accepted: true,
        principalKobo: 100,
        paidInterestKobo: 0,
        pendingInterestKobo: 0,
      }).success
    ).toBe(true);
  });

  it('rejects an unaccepted confirmation', () => {
    expect(
      cancelPlanSchemas.confirmation.safeParse({
        operationId: uuid,
        actorId: uuid,
        revisionId: uuid,
        termsVersion: 'v1',
        termsHash,
        consentVersion: '2026-09-11',
        accepted: false,
        principalKobo: 100,
        paidInterestKobo: 0,
        pendingInterestKobo: 0,
      }).success
    ).toBe(false);
  });

  it('accepts the policy-specific source row', () => {
    expect(
      cancelPlanSchemas.source.safeParse([
        { result: { status: 'requires_policy_specific_handling' } },
      ]).success
    ).toBe(true);
    expect(cancelPlanSchemas.source.safeParse([]).success).toBe(false);
  });

  it('accepts a prepared row', () => {
    expect(
      cancelPlanSchemas.prepared.safeParse([
        {
          result: {
            status: 'prepared',
            operationId: uuid,
            collectionPaused: true,
            dispatch: 'contract_gap',
            interestDisposition: 'unresolved',
          },
        },
      ]).success
    ).toBe(true);
  });
});
