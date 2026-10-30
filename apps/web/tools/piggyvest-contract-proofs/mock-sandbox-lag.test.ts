import { describe, expect, it } from 'vitest';
import {
  listedTransactions,
  markStaleBalance,
  settingsVisible,
  visibleBalance,
} from './mock-sandbox-lag';
import type { Txn, Wallet } from './mock-sandbox-types';

const wallet = (over: Partial<Wallet> = {}): Wallet => ({
  id: 'w',
  customerId: 'c',
  name: 'n',
  createdAt: 't',
  balance: 100,
  withdrawalCount: 0,
  lagged: null,
  payoutWalletId: null,
  interestEnabled: false,
  staleBalance: null,
  settingsHiddenReads: 0,
  account: '9000000000',
  ...over,
});
const txn = (id: string, hiddenReads = 0): Txn => ({
  id,
  creditId: `${id}c`,
  reference: null,
  category: 'p2p',
  source: null,
  destination: null,
  amount: 1,
  fee: 0,
  status: 'success',
  polls: 0,
  hiddenReads,
  createdAt: 't',
});

describe('balance lag', () => {
  it('shows the pre-change balance for the configured number of reads, then the real one', () => {
    const w = wallet({ balance: 100 });
    markStaleBalance(w, 2);
    w.balance = 150;
    expect([
      visibleBalance(w),
      visibleBalance(w),
      visibleBalance(w),
      visibleBalance(w),
    ]).toEqual([100, 100, 150, 150]);
    expect(w.staleBalance).toBeNull();
  });

  it('is a no-op with no lag, and shows the real balance when nothing is stale', () => {
    const w = wallet({ balance: 7 });
    markStaleBalance(w, 0);
    expect(w.staleBalance).toBeNull();
    expect(visibleBalance(w)).toBe(7);
  });

  it('keeps the OLDEST stale value across back-to-back changes and restarts the countdown', () => {
    const w = wallet({ balance: 100 });
    markStaleBalance(w, 3);
    w.balance = 150;
    visibleBalance(w);
    markStaleBalance(w, 3);
    w.balance = 200;
    expect(w.staleBalance).toEqual({ value: 100, readsLeft: 3 });
  });
});

describe('list lag', () => {
  it('hides new rows for N list reads and reveals them afterwards', () => {
    const rows = [txn('old'), txn('new', 2)];
    expect(listedTransactions(rows).map((t) => t.id)).toEqual(['old']);
    expect(listedTransactions(rows).map((t) => t.id)).toEqual(['old']);
    expect(listedTransactions(rows).map((t) => t.id)).toEqual(['old', 'new']);
  });
});

describe('settings lag', () => {
  it('hides interest settings for N readbacks, then shows them', () => {
    const w = wallet({ settingsHiddenReads: 2 });
    expect([
      settingsVisible(w),
      settingsVisible(w),
      settingsVisible(w),
    ]).toEqual([false, false, true]);
    expect(settingsVisible(wallet())).toBe(true);
  });
});
