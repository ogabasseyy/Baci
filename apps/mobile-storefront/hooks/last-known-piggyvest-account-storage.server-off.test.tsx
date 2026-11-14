import { beforeEach, describe, expect, it } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  readLastKnownPiggyvestAccount,
  syncLastKnownPiggyvestAccount,
} from './last-known-piggyvest-account-storage';
import type { WalletQueryData } from './wallet-query';

const account = {
  account_name: 'OGB / ADA',
  account_number: '9814644749',
  bank_name: 'Provider Bank',
  provider: 'piggyvest',
};

function load(wallet: Record<string, unknown>): WalletQueryData {
  return {
    transactions: [],
    wallet: { balance: 0, loyalty_points: 0, ...wallet },
  } as WalletQueryData;
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('last-known PiggyVest account with the server keeping PiggyVest off', () => {
  it('saves nothing for a legacy wallet', async () => {
    await syncLastKnownPiggyvestAccount(
      'merchant-1',
      'user-1',
      load({ funding_account: { ...account, provider: 'paystack' } })
    );
    await expect(
      readLastKnownPiggyvestAccount('merchant-1', 'user-1')
    ).resolves.toBeNull();
  });

  it('forgets a saved account once a fresh read says there is none', async () => {
    await syncLastKnownPiggyvestAccount(
      'merchant-1',
      'user-1',
      load({ funding_account: account })
    );
    await syncLastKnownPiggyvestAccount(
      'merchant-1',
      'user-1',
      load({ funding_account: null })
    );
    await expect(
      readLastKnownPiggyvestAccount('merchant-1', 'user-1')
    ).resolves.toBeNull();
  });
});

describe('bugfix: cold launch lost the PiggyVest account number (walk 14)', () => {
  it('keeps the account through a failed read, scoped to store and user', async () => {
    await syncLastKnownPiggyvestAccount(
      'merchant-1',
      'user-1',
      load({ funding_account: account })
    );
    await syncLastKnownPiggyvestAccount(
      'merchant-1',
      'user-1',
      load({ funding_account: null, primary_unavailable: true })
    );

    await expect(
      readLastKnownPiggyvestAccount('merchant-1', 'user-1')
    ).resolves.toEqual(account);
    await expect(
      readLastKnownPiggyvestAccount('merchant-1', 'user-2')
    ).resolves.toBeNull();
    await expect(
      readLastKnownPiggyvestAccount('merchant-2', 'user-1')
    ).resolves.toBeNull();
  });
});
