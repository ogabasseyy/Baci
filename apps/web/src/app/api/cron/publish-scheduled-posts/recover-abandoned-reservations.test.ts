import { describe, expect, it, vi } from 'vitest';
import { recoverMerchantBlogReleaseReservations } from './recover-abandoned-reservations';

describe('recoverMerchantBlogReleaseReservations', () => {
  it('aggregates counts across merchants and records non-fatal RPC failures', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mockRpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          cancelled_abandoned_count: 2,
          preserved_scheduled_count: 1,
          reconciled_published_count: 1,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'rpc timeout' },
      });

    try {
      const summary = await recoverMerchantBlogReleaseReservations(
        { rpc: mockRpc } as never,
        ['merchant-1', 'merchant-2']
      );

      expect(summary).toEqual({
        cancelledAbandonedCount: 2,
        failedMerchants: ['merchant-2'],
        preservedScheduledCount: 1,
        reconciledPublishedCount: 1,
      });
    } finally {
      errorSpy.mockRestore();
    }
  });
});
