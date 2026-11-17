import { walletHeadStarts } from './pending-wallet-head-start';

describe('pending wallet head start with PiggyVest off', () => {
  it('remembers a pay-now head start until it is taken, once', () => {
    walletHeadStarts.remember('goal-a', 100);
    expect(walletHeadStarts.lookup('goal-a')).toBe(100);
    expect(walletHeadStarts.take('goal-a')).toBe(100);
    expect(walletHeadStarts.take('goal-a')).toBeNull();
    expect(walletHeadStarts.lookup('goal-a')).toBeNull();
  });

  it('ignores a missing goal or an amount that is not whole positive naira', () => {
    walletHeadStarts.remember('', 100);
    walletHeadStarts.remember('goal-b', 0);
    walletHeadStarts.remember('goal-c', 10.5);
    walletHeadStarts.remember('goal-d', Number.NaN);
    expect(walletHeadStarts.lookup('')).toBeNull();
    expect(walletHeadStarts.lookup('goal-b')).toBeNull();
    expect(walletHeadStarts.lookup('goal-c')).toBeNull();
    expect(walletHeadStarts.lookup('goal-d')).toBeNull();
  });
});
