import { describe, expect, it } from 'vitest';
import { piggyvestCancellationReviewSchemas as schemas } from './piggyvest-cancellation-review';

const goalId = '11111111-1111-4111-8111-111111111111';
const operationId = '22222222-2222-4222-8222-222222222222';
const quote = {
  status: 'quote_available',
  goalId,
  revisionId: goalId,
  termsVersion: 'synthetic-v1',
  termsHash: 'a'.repeat(64),
  consentVersion: '2026-09-11',
  principalKobo: 10000,
  paidInterestKobo: 100,
  pendingInterestKobo: 200,
  interestDisposition: 'unresolved',
  dispatch: 'contract_gap',
};

describe('public cancellation contracts', () => {
  it('preserves the exact quote and public confirmation only', () => {
    expect(schemas.quote.parse(quote)).toEqual(quote);
    const { status, dispatch, interestDisposition, ...fields } = quote;
    const confirmation = { ...fields, operationId, accepted: true };
    expect(schemas.confirmation.parse(confirmation)).toEqual(confirmation);
    expect(
      schemas.confirmation.safeParse({ ...confirmation, actorId: goalId })
        .success
    ).toBe(false);
  });
  it.each([
    { actorId: goalId },
    { configuration: {} },
    { principalKobo: 0 },
    { paidInterestKobo: -1 },
    { pendingInterestKobo: 1.5 },
    { principalKobo: Number.MAX_SAFE_INTEGER + 1 },
    { consentVersion: 'other' },
    { dispatch: 'completed' },
    { interestDisposition: 'forfeited' },
    { termsHash: 'bad' },
  ])('rejects invalid quote fields %j', (change) => {
    expect(schemas.quote.safeParse({ ...quote, ...change }).success).toBe(
      false
    );
  });
  it.each([
    'unavailable',
    'requires_policy_specific_handling',
  ])('accepts only minimal %s states', (status) => {
    expect(schemas.quote.parse({ status, goalId })).toEqual({ status, goalId });
    expect(
      schemas.quote.safeParse({ status, goalId, principalKobo: 10 }).success
    ).toBe(false);
  });
  it('distinguishes prepared from refunded and unresolved from released', () => {
    const receipt = {
      status: 'prepared',
      goalId,
      operationId,
      collectionPaused: true,
      dispatch: 'contract_gap',
      interestDisposition: 'unresolved',
    };
    expect(schemas.receipt.parse(receipt)).toEqual(receipt);
    expect(
      schemas.receipt.safeParse({ ...receipt, refunded: true }).success
    ).toBe(false);
    expect(
      schemas.receipt.parse({
        status: 'unavailable',
        goalId,
        operationId,
        reservation: 'may_be_retained',
        dispatch: 'contract_gap',
      })
    ).toMatchObject({ reservation: 'may_be_retained' });
  });
});
