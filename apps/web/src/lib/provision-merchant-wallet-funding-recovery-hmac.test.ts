import { afterEach, describe, expect, it, vi } from 'vitest';
import { provisionMerchantWalletFundingRecoveryHmac } from './provision-merchant-wallet-funding-recovery-hmac';

describe('provisionMerchantWalletFundingRecoveryHmac', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('writes the app env secret into the shared DB setter RPC', async () => {
    vi.stubEnv(
      'MERCHANT_WALLET_FUNDING_RECOVERY_HMAC_SECRET',
      'deployment-shared-secret-value-32b'
    );
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    await provisionMerchantWalletFundingRecoveryHmac({ rpc } as never);
    expect(rpc).toHaveBeenCalledWith(
      'set_merchant_wallet_funding_recovery_hmac_secret',
      { p_secret: 'deployment-shared-secret-value-32b' }
    );
  });

  it('fails closed when the shared secret is missing or too short', async () => {
    vi.stubEnv('MERCHANT_WALLET_FUNDING_RECOVERY_HMAC_SECRET', 'short');
    await expect(
      provisionMerchantWalletFundingRecoveryHmac({
        rpc: vi.fn(),
      } as never)
    ).rejects.toThrow(/MERCHANT_WALLET_FUNDING_RECOVERY_HMAC_SECRET/);
  });
});
