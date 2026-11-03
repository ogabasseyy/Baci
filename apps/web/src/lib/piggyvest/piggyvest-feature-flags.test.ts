import { describe, expect, it } from 'vitest';
import { PIGGYVEST_FEATURE_FLAGS } from './piggyvest-feature-flags';

describe('feature flag registry', () => {
  it('registers the new-money features', () => {
    expect(Object.keys(PIGGYVEST_FEATURE_FLAGS).sort()).toEqual(
      [
        'bank_inbox',
        'card_checkout',
        'card_signed_inbox',
        'card_custody',
        'deposit_to_goal',
        'goal_provisioning',
        'inflows',
        'paid_interest',
        'paid_interest_inbox',
        'plan_funding',
        'wallet',
      ].sort()
    );
  });
  it('maps every feature to a distinct *_ENABLED variable', () => {
    const names = Object.values(PIGGYVEST_FEATURE_FLAGS);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^PIGGYVEST_\w+_ENABLED$/);
  });
});
