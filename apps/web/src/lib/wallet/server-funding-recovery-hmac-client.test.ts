import { describe, expect, it, vi } from 'vitest';

const createServiceClient = vi.fn(() => ({ branded: true }));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient,
}));

describe('createWalletFundingRecoveryHmacServiceClient', () => {
  it('constructs the dedicated wallet-funding-recovery sentinel', async () => {
    const { createWalletFundingRecoveryHmacServiceClient } = await import(
      './server-funding-recovery-hmac-client'
    );

    expect(createWalletFundingRecoveryHmacServiceClient()).toEqual({
      branded: true,
    });
    expect(createServiceClient).toHaveBeenCalledWith('wallet-funding-recovery');
  });
});
