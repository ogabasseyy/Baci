import { describe, expect, it } from 'vitest';
import { emptyScenarioState } from './proof-context';

describe('emptyScenarioState', () => {
  it('starts with nothing known: no customer, no wallets, no observations', () => {
    expect(emptyScenarioState()).toEqual({
      customerId: null,
      createdWalletId: null,
      createdNewCustomer: null,
      mainWalletId: null,
      mainWalletBasis: 'none',
      goalWalletId: null,
      wallets: [],
      authorized: new Set(),
      notes: [],
      walletTransfer: null,
      bankTransfer: null,
      deposit: null,
    });
  });

  it('returns independent state each call, so runs and tests never share wallets or notes', () => {
    const a = emptyScenarioState();
    const b = emptyScenarioState();
    a.authorized.add('wallet-1');
    a.notes.push('x');
    a.wallets.push({ id: 'w', role: 'main', createdAt: null, name: null });
    expect(b.authorized.size).toBe(0);
    expect(b.notes).toEqual([]);
    expect(b.wallets).toEqual([]);
  });
});
