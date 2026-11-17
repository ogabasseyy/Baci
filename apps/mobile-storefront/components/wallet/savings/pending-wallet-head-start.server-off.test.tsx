import {
  pendingWalletHeadStart,
  rememberWalletHeadStart,
  takeWalletHeadStart,
} from './pending-wallet-head-start';

describe('pending wallet head start with PiggyVest off', () => {
  it('remembers a pay-now head start until it is taken, once', () => {
    rememberWalletHeadStart('goal-a', 100);
    expect(pendingWalletHeadStart('goal-a')).toBe(100);
    expect(takeWalletHeadStart('goal-a')).toBe(100);
    expect(takeWalletHeadStart('goal-a')).toBeNull();
    expect(pendingWalletHeadStart('goal-a')).toBeNull();
  });

  it('ignores a missing goal or an amount that is not whole positive naira', () => {
    rememberWalletHeadStart('', 100);
    rememberWalletHeadStart('goal-b', 0);
    rememberWalletHeadStart('goal-c', 10.5);
    rememberWalletHeadStart('goal-d', Number.NaN);
    expect(pendingWalletHeadStart('')).toBeNull();
    expect(pendingWalletHeadStart('goal-b')).toBeNull();
    expect(pendingWalletHeadStart('goal-c')).toBeNull();
    expect(pendingWalletHeadStart('goal-d')).toBeNull();
  });
});
