import { describe, expect, it } from 'vitest';
import { analysePayoutReadback } from './payout-analysis';

const TARGET = 'business-wallet-0001';
const OWN = 'customer-wallet-0001';

describe('analysePayoutReadback', () => {
  it('finds interest and payout fields and which one names the destination', () => {
    const facts = analysePayoutReadback(
      {
        id: OWN,
        balance: 0,
        enable_interest_accrual: true,
        interest_payout_wallet: TARGET,
        current_interest_rate: 0,
      },
      TARGET,
      OWN
    );
    expect([...facts.interestFieldPaths].sort()).toEqual([
      'enable_interest_accrual',
      'interest_payout_wallet',
    ]);
    expect(facts.rateFieldPaths).toEqual(['current_interest_rate']);
    expect(facts.matchesTarget).toEqual(['interest_payout_wallet']);
    expect(facts.matchesOwn).toEqual([]);
    expect(facts.accrualEnabled).toBe(true);
  });

  it('looks one level into nested settings objects', () => {
    const facts = analysePayoutReadback(
      { interest: { payout_wallet: TARGET, enabled: false } },
      TARGET,
      OWN
    );
    expect(facts.matchesTarget).toEqual(['interest.payout_wallet']);
    expect(facts.accrualEnabled).toBe(false);
  });

  it('reports a payout field that points at the wallet itself', () => {
    const facts = analysePayoutReadback(
      { interest_payout_wallet: OWN },
      TARGET,
      OWN
    );
    expect(facts.matchesOwn).toEqual(['interest_payout_wallet']);
    expect(facts.matchesTarget).toEqual([]);
  });

  it('says nothing is readable when no interest field exists', () => {
    const facts = analysePayoutReadback(
      { id: OWN, balance: 5, name: 'x' },
      TARGET,
      OWN
    );
    expect(facts).toMatchObject({
      interestFieldPaths: [],
      matchesTarget: [],
      accrualEnabled: null,
    });
  });

  it('copes with non-objects and null payout fields', () => {
    expect(analysePayoutReadback(null, TARGET, OWN).interestFieldPaths).toEqual(
      []
    );
    const facts = analysePayoutReadback(
      { interest_payout_wallet: null },
      TARGET,
      OWN
    );
    expect(facts.interestFieldPaths).toEqual(['interest_payout_wallet']);
    expect(facts.matchesTarget).toEqual([]);
  });
});
