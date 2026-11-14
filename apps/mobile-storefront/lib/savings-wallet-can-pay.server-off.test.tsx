import { describe, expect, it } from '@jest/globals';
import { SAVINGS_WALLET_CAN_PAY } from './savings-wallet-can-pay';

// The savings wallet can't pay for purchases until "Pay from your wallet"
// ships, so the switch stays off and purchase screens keep store credit.
describe('SAVINGS_WALLET_CAN_PAY', () => {
  it('stays off until the savings wallet can pay', () => {
    expect(SAVINGS_WALLET_CAN_PAY).toBe(false);
  });
});
