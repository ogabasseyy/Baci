import { describe, expect, it } from 'vitest';
import {
  fixture,
  goalId,
  ready,
  scope,
  walletName,
} from './primary-savings-provisioning.input.test-support';

describe('primary-savings-provisioning input test support', () => {
  it('derives the wallet name the way the database names goal wallets', () => {
    expect(walletName).toBe(`baci-save:${scope.integrationId}:${goalId}`);
  });

  it('builds independent doubles on every call', async () => {
    const first = fixture();
    const second = fixture();
    await first.createWallet();
    expect(first.createWallet).toHaveBeenCalledOnce();
    expect(second.createWallet).not.toHaveBeenCalled();
  });

  it('describes one wallet consistently across the list, the retrieve and the ready outcome', async () => {
    const input = fixture();
    const [listed] = await input.listWallets();
    const retrieved = await input.retrieveWallet();
    const [account] = await input.retrieveAccounts();
    expect(listed).toMatchObject({ id: retrieved.id, name: retrieved.name });
    expect(retrieved.business_id).toBe(scope.businessId);
    expect(ready.goalId).toBe(goalId);
    expect(ready.accounts).toEqual([
      {
        accountNumber: account.account_number,
        accountName: account.account_name,
        bankName: account.bank_name,
      },
    ]);
  });
});
