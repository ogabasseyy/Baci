import { describe, expect, it } from '@jest/globals';
import { SAVINGS_WALLET_CAN_PAY_UTILITIES } from './savings-wallet-can-pay-utilities';

// Utilities can't spend the savings wallet until VTU wallet pay ships.
describe('SAVINGS_WALLET_CAN_PAY_UTILITIES', () => {
  it('stays off until utilities can pay from the savings wallet', () => {
    expect(SAVINGS_WALLET_CAN_PAY_UTILITIES).toBe(false);
  });
});
