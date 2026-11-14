import { describe, expect, it } from 'vitest';
import { createHouseWallet } from './mock-house-wallet';
import { walletAccountsReply } from './mock-wallet-accounts';

describe('walletAccountsReply', () => {
  it("lists the wallet's single funding account", () => {
    const wallet = createHouseWallet('house-1', '2026-10-30T10:00:00.000Z');
    expect(walletAccountsReply(wallet)).toEqual({
      status: 200,
      body: {
        status: true,
        message: 'ok',
        data: [
          {
            account_number: '9100000001',
            account_name: 'Ogabassey Collection',
            bank_name: 'FAAS (SANDBOX)',
            paypoint_name: null,
            paypoint_id: null,
          },
        ],
      },
    });
  });

  it('declines an unknown wallet', () => {
    expect(walletAccountsReply(undefined)).toEqual({
      status: 400,
      body: {
        status: false,
        message: 'Failed to get virtual accounts for wallet',
      },
    });
  });
});
