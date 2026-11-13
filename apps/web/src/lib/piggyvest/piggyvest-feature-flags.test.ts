import { describe, expect, it } from 'vitest';
import { PIGGYVEST_FEATURE_FLAGS } from './piggyvest-feature-flags';

describe('feature flag registry', () => {
  it('registers the new-money features and the read-only reconciliation switch', () => {
    expect(Object.keys(PIGGYVEST_FEATURE_FLAGS).sort()).toEqual(
      [
        'bank_inbox',
        'card_checkout',
        'card_signed_inbox',
        'card_custody',
        'daily_reconciliation',
        'deposit_to_goal',
        'goal_provisioning',
        'inflows',
        'paid_interest',
        'paid_interest_inbox',
        'plan_funding',
        'prefunded_card_checkout',
        'prefunded_card_checkout_mutations',
        'prefunded_card_contributions',
        'wallet',
        'wallet_pay',
      ].sort()
    );
  });
  it('maps every feature to a distinct *_ENABLED variable', () => {
    const names = Object.values(PIGGYVEST_FEATURE_FLAGS);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[A-Z][A-Z0-9_]*_ENABLED$/);
  });
});
