import { describe, expect, it } from 'vitest';
import { PIGGYVEST_PLAN_WALLET_NAME } from './plan-wallet-name.constants';
import { PIGGYVEST_SUBACCOUNT_NAME_MAX_CHARACTERS } from './provider-wallet-name.constants';

describe('PiggyVest subaccount name limit', () => {
  it('pins the observed 50-character provider limit shared by both rails', () => {
    expect(PIGGYVEST_SUBACCOUNT_NAME_MAX_CHARACTERS).toBe(50);
    expect(PIGGYVEST_PLAN_WALLET_NAME.maxCharacters).toBe(
      PIGGYVEST_SUBACCOUNT_NAME_MAX_CHARACTERS
    );
  });
});
