import { fail, type MockReply, ok, type Wallet } from './mock-sandbox-types';

/** GET /wallet/:id/accounts in the mock: the wallet's one funding account. */
export function walletAccountsReply(wallet: Wallet | undefined): MockReply {
  if (!wallet) return fail('Failed to get virtual accounts for wallet');
  return ok([
    {
      account_number: wallet.account,
      account_name: wallet.name,
      bank_name: 'FAAS (SANDBOX)',
      paypoint_name: null,
      paypoint_id: null,
    },
  ]);
}
