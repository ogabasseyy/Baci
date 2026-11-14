import type { Wallet } from './mock-sandbox-types';

/**
 * The Ogabassey business ("house") wallet in the mock: it belongs to the
 * business and is bound to no API customer, so `customerId` is empty and the
 * readback shows `api_customer_id: null`. It starts empty, like any new
 * sandbox wallet, and is never listed among a customer's wallets.
 */
export function createHouseWallet(id: string, createdAt: string): Wallet {
  return {
    id,
    customerId: '',
    name: 'Ogabassey Collection',
    createdAt,
    balance: 0,
    withdrawalCount: 0,
    lagged: null,
    staleBalance: null,
    settingsHiddenReads: 0,
    payoutHiddenReads: 0,
    payoutWalletId: null,
    interestEnabled: false,
    account: '9100000001',
  };
}
