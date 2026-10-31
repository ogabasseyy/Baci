import { describe, expect, it } from 'vitest';
import {
  analysePayoutReadback,
  destinationAnswer,
  destinationReadable,
  inheritanceAnswer,
  mergePayoutReadbacks,
} from './payout-analysis';

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

describe('payoutFieldPaths and inheritanceAnswer', () => {
  const MAIN_PATHS = ['interest_payout_wallet'];

  it('lists payout-keyed fields whatever their value', () => {
    const facts = analysePayoutReadback(
      { enable_interest_accrual: true, interest_payout_wallet: null },
      TARGET,
      OWN
    );
    expect(facts.payoutFieldPaths).toEqual(['interest_payout_wallet']);
    expect(
      analysePayoutReadback({ enable_interest_accrual: true }, TARGET, OWN)
        .payoutFieldPaths
    ).toEqual([]);
  });

  it('yes: the goal wallet readback names the business wallet', () => {
    const goal = analysePayoutReadback(
      { interest_payout_wallet: TARGET },
      TARGET,
      OWN
    );
    expect(inheritanceAnswer(goal, MAIN_PATHS)).toBe('yes');
  });

  it('no: the same payout field is readable and is null or another wallet', () => {
    for (const value of [null, 'some-other-wallet-id']) {
      const goal = analysePayoutReadback(
        { interest_payout_wallet: value },
        TARGET,
        OWN
      );
      expect(inheritanceAnswer(goal, MAIN_PATHS)).toBe('no');
    }
  });

  it('unknown: unrelated interest settings but the payout destination is omitted', () => {
    const goal = analysePayoutReadback(
      { enable_interest_accrual: true },
      TARGET,
      OWN
    );
    expect(inheritanceAnswer(goal, MAIN_PATHS)).toBe('unknown');
  });

  it('unknown: the main wallet never showed which field holds the destination', () => {
    const goal = analysePayoutReadback(
      { interest_payout_wallet: null },
      TARGET,
      OWN
    );
    expect(inheritanceAnswer(goal, [])).toBe('unknown');
  });

  it('unknown: no readback at all', () => {
    expect(inheritanceAnswer(null, MAIN_PATHS)).toBe('unknown');
  });
});

describe('destinationReadable / destinationAnswer', () => {
  const facts = (data: Record<string, unknown>) =>
    analysePayoutReadback(data, TARGET, OWN);

  it('is readable once any field naming a payout destination is present, whatever its value', () => {
    expect(destinationReadable(facts({ enable_interest_accrual: true }))).toBe(
      false
    );
    expect(destinationReadable(facts({ interest_payout_wallet: null }))).toBe(
      true
    );
    expect(destinationReadable(facts({ interest_destination: TARGET }))).toBe(
      true
    );
    expect(destinationReadable(null)).toBe(false);
  });

  it('answers yes for a match, no only for a readable field that differs, else unknown', () => {
    expect(destinationAnswer(facts({ interest_payout_wallet: TARGET }))).toBe(
      'yes'
    );
    expect(destinationAnswer(facts({ interest_payout_wallet: null }))).toBe(
      'no'
    );
    expect(destinationAnswer(facts({ interest_payout_wallet: OWN }))).toBe(
      'no'
    );
    expect(destinationAnswer(facts({ enable_interest_accrual: true }))).toBe(
      'unknown'
    );
    expect(destinationAnswer(null)).toBe('unknown');
  });
});

describe('mergePayoutReadbacks', () => {
  const flagOnly = analysePayoutReadback(
    { enable_interest_accrual: true },
    TARGET,
    OWN
  );
  const withPayout = analysePayoutReadback(
    { enable_interest_accrual: true, interest_payout_wallet: TARGET },
    TARGET,
    OWN
  );

  it('starts from the first reading', () => {
    expect(mergePayoutReadbacks(null, flagOnly)).toEqual(flagOnly);
  });

  it('keeps flags already seen and adds the fields a later reading shows', () => {
    const merged = mergePayoutReadbacks(flagOnly, withPayout);
    expect(merged.accrualEnabled).toBe(true);
    expect([...merged.interestFieldPaths].sort()).toEqual([
      'enable_interest_accrual',
      'interest_payout_wallet',
    ]);
    expect(merged.matchesTarget).toEqual(['interest_payout_wallet']);
    expect(merged.payoutFieldPaths).toEqual(['interest_payout_wallet']);
  });

  it('does not lose the flag when a later reading has none, and never duplicates a path', () => {
    const later = analysePayoutReadback(
      { interest_payout_wallet: null },
      TARGET,
      OWN
    );
    const merged = mergePayoutReadbacks(
      mergePayoutReadbacks(null, flagOnly),
      later
    );
    expect(merged.accrualEnabled).toBe(true);
    expect(mergePayoutReadbacks(merged, merged).interestFieldPaths).toEqual(
      merged.interestFieldPaths
    );
  });

  it('lets a later reading change the flag value', () => {
    const off = analysePayoutReadback(
      { enable_interest_accrual: false },
      TARGET,
      OWN
    );
    expect(mergePayoutReadbacks(flagOnly, off).accrualEnabled).toBe(false);
  });
});
