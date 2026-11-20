import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRpc = vi.fn();

vi.mock('dotenv/config', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
}));

import { runCleanupCheckoutShippingRecoveryPreviewsCli } from './cleanup-checkout-shipping-recovery-previews';

describe('cleanup-checkout-shipping-recovery-previews CLI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs the retention sweep RPC and returns 0', async () => {
    mockRpc.mockResolvedValueOnce({ data: 3, error: null });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      await expect(
        runCleanupCheckoutShippingRecoveryPreviewsCli()
      ).resolves.toBe(0);
      expect(mockRpc).toHaveBeenCalledWith(
        'cleanup_customer_checkout_shipping_recovery_previews',
        { p_limit: 1000 }
      );
      expect(logSpy).toHaveBeenCalledWith(JSON.stringify({ purged: 3 }));
    } finally {
      logSpy.mockRestore();
    }
  });

  it('throws when the RPC returns an error', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'db timeout' },
    });

    await expect(
      runCleanupCheckoutShippingRecoveryPreviewsCli()
    ).rejects.toThrow(
      'Failed to clean up checkout shipping recovery previews: db timeout'
    );
  });
});
