import { describe, expect, it, vi } from 'vitest';
import { readScopedPiggyvestWalletMapping } from './scoped-wallet-mapping-reader';

const configuration = {
  environment: 'staging',
  integrationId: '40000000-0000-4000-8000-000000000001',
  expectedMerchantId: '10000000-0000-4000-8000-000000000001',
};
const scope = {
  merchantId: configuration.expectedMerchantId,
  customerId: '20000000-0000-4000-8000-000000000001',
  goalId: '30000000-0000-4000-8000-000000000001',
};

describe('readScopedPiggyvestWalletMapping', () => {
  it('uses the exact integration, merchant, customer, and goal scope', async () => {
    const execute = vi.fn().mockResolvedValue({
      rows: [
        {
          provider_wallet_id: 'wallet-1',
          provider_customer_id: 'customer-1',
        },
      ],
    });

    await expect(
      readScopedPiggyvestWalletMapping({ configuration, scope, execute })
    ).resolves.toEqual({
      providerWalletId: 'wallet-1',
      providerCustomerId: 'customer-1',
    });
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('read_scoped_wallet_mapping'),
      [
        configuration.integrationId,
        scope.merchantId,
        scope.customerId,
        scope.goalId,
      ]
    );
  });

  it('does not execute when the caller scope does not match the runtime merchant', async () => {
    const execute = vi.fn();

    await expect(
      readScopedPiggyvestWalletMapping({
        configuration,
        scope: { ...scope, merchantId: '50000000-0000-4000-8000-000000000001' },
        execute,
      })
    ).resolves.toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });
});
