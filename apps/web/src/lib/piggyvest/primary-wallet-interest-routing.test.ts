import { describe, expect, it, vi } from 'vitest';
import { readPrimaryWalletInterestRouting } from './primary-wallet-interest-routing';
import {
  OTHER_WALLET_ID,
  PAYOUT_WALLET_ID,
  routedWallet,
} from './primary-wallet-onboarding.test-fixture';

vi.mock('server-only', () => ({}));

function read(readback: () => Promise<unknown>) {
  return readPrimaryWalletInterestRouting({
    walletId: 'wallet-fixture',
    customerId: 'customer-fixture',
    businessId: 'business-fixture',
    payoutWalletId: PAYOUT_WALLET_ID,
    retrieveWallet: readback,
  });
}

describe('primary wallet interest routing readback', () => {
  it('reads the created wallet by its own id', async () => {
    const retrieveWallet = vi.fn().mockResolvedValue(routedWallet());
    await readPrimaryWalletInterestRouting({
      walletId: 'wallet-fixture',
      customerId: 'customer-fixture',
      businessId: 'business-fixture',
      payoutWalletId: PAYOUT_WALLET_ID,
      retrieveWallet,
    });
    expect(retrieveWallet).toHaveBeenCalledExactlyOnceWith('wallet-fixture');
  });

  it.each([
    ['routed', routedWallet()],
    [
      'routing_contradicted',
      routedWallet({ interest_payout_wallet: OTHER_WALLET_ID }),
    ],
    ['contradicted', routedWallet({ id: 'another-wallet' })],
    ['contradicted', routedWallet({ api_customer_id: 'another-customer' })],
    ['contradicted', routedWallet({ business_id: 'another-business' })],
    ['contradicted', { interest_enabled: true }],
    ['routing_contradicted', routedWallet({ interest_payout_wallet: 7 })],
    ['routing_contradicted', routedWallet({ interest_enabled: 'false' })],
    ['unsettled', routedWallet({ interest_payout_wallet: null })],
    ['unsettled', routedWallet({ interest_payout_wallet: undefined })],
    ['routing_contradicted', routedWallet({ interest_enabled: false })],
    [
      'routing_contradicted',
      routedWallet({ interest_enabled: false, interest_payout_wallet: null }),
    ],
    ['unsettled', routedWallet({ interest_enabled: null })],
    ['unsettled', routedWallet({ interest_enabled: undefined })],
  ])('classifies a readable wallet as %s', async (verdict, wallet) => {
    expect(await read(() => Promise.resolve(wallet))).toBe(verdict);
  });

  it('reports a failed read as unreadable instead of throwing', async () => {
    expect(await read(() => Promise.reject(new Error('timeout')))).toBe(
      'unreadable'
    );
  });
});
