import { describe, expect, it } from 'vitest';
import { piggyvestGoalCancelForfeitSchemas as schemas } from './piggyvest-goal-cancel-forfeit';

const goalId = '55555555-5555-4555-8555-555555555555';
const forfeit = {
  operationId: '77777777-7777-4777-8777-777777777777',
  goalId,
  amountKobo: 12000,
  sourceWalletId: 'goal-wallet',
  destinationWalletId: 'interest-wallet',
  reference: `pvb-forfeit-${goalId}`,
  businessId: 'business',
  providerCustomerId: 'customer',
};

describe('split answer', () => {
  it('accepts a dispatched split and each refusal', () => {
    expect(
      schemas.splitRows.parse([
        {
          result: {
            status: 'dispatched',
            principalKobo: 1,
            forfeitedInterestKobo: 0,
          },
        },
      ])[0].result.status
    ).toBe('dispatched');
    for (const status of ['not_claimed', 'needs_review', 'forfeit_unavailable'])
      expect(
        schemas.splitRows.safeParse([{ result: { status } }]).success
      ).toBe(true);
  });

  it('refuses a zero principal, negative interest or an amount above the ledger range', () => {
    for (const bad of [
      { principalKobo: 0, forfeitedInterestKobo: 0 },
      { principalKobo: 1, forfeitedInterestKobo: -1 },
      { principalKobo: 10_000_000_000, forfeitedInterestKobo: 0 },
    ])
      expect(
        schemas.splitRows.safeParse([
          { result: { status: 'dispatched', ...bad } },
        ]).success
      ).toBe(false);
  });
});

describe('amounts', () => {
  it('accepts the split or null, never extra fields', () => {
    expect(schemas.amountsRows.safeParse([{ result: null }]).success).toBe(
      true
    );
    expect(
      schemas.amountsRows.safeParse([
        { result: { principalKobo: 5, forfeitedInterestKobo: 1, extra: 1 } },
      ]).success
    ).toBe(false);
  });
});

describe('forfeit transfer', () => {
  it('accepts a forfeit reference, bare or numbered', () => {
    expect(schemas.forfeit.parse(forfeit)).toEqual(forfeit);
    expect(schemas.reference.safeParse(`pvb-forfeit-${goalId}-3`).success).toBe(
      true
    );
  });

  it('refuses a customer-leg reference so interest can never ride the refund reference', () => {
    expect(
      schemas.forfeit.safeParse({
        ...forfeit,
        reference: `pvb-cancel-${goalId}`,
      }).success
    ).toBe(false);
    expect(schemas.reference.safeParse(`pvb-forfeit-${goalId}-0`).success).toBe(
      false
    );
  });

  it('accepts every claim answer and refuses an unknown one', () => {
    expect(
      schemas.claimRows.safeParse([{ result: { status: 'claimed', forfeit } }])
        .success
    ).toBe(true);
    expect(
      schemas.claimRows.safeParse([
        { result: { status: 'pending', forfeitId: forfeit.operationId } },
      ]).success
    ).toBe(true);
    expect(
      schemas.claimRows.safeParse([{ result: { status: 'sent' } }]).success
    ).toBe(false);
  });

  it('lets only a stuck forfeit ask for a page', () => {
    expect(
      schemas.claimRows.safeParse([
        { result: { status: 'unavailable', alert: true } },
      ]).success
    ).toBe(true);
    expect(
      schemas.claimRows.safeParse([
        { result: { status: 'waiting', alert: true } },
      ]).success
    ).toBe(false);
  });
});
