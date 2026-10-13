import { describe, expect, it, vi } from 'vitest';
import { logMerchantWalletProvisioningError } from './merchant-wallet-provisioning-logging';

describe('logMerchantWalletProvisioningError', () => {
  it('logs only safe request correlation fields and the error message', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    logMerchantWalletProvisioningError(
      'provisioning failed',
      'request-1',
      'merchant-1',
      new Error('provider timeout')
    );

    expect(spy).toHaveBeenCalledWith('provisioning failed', {
      requestId: 'request-1',
      merchantId: 'merchant-1',
      error: 'provider timeout',
    });
    spy.mockRestore();
  });
});
