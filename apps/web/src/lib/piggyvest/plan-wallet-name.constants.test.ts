import { describe, expect, it } from 'vitest';
import { PIGGYVEST_PLAN_WALLET_NAME } from './plan-wallet-name.constants';

describe('PIGGYVEST_PLAN_WALLET_NAME', () => {
  it('pins the reviewed wallet-name budget', () => {
    expect(PIGGYVEST_PLAN_WALLET_NAME).toEqual({
      maxCharacters: 50,
      suffixCharacters: 16,
      legacyHashCharacters: 40,
      label: ' Savings ',
      fallbackCustomer: 'Customer',
    });
  });
});
