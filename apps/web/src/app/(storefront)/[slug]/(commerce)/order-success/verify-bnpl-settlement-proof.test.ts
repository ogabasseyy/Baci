import { describe, expect, it, vi } from 'vitest';
import { verifyBnplSettlementProof } from './verify-bnpl-settlement-proof';

describe('verifyBnplSettlementProof', () => {
  it('returns true for a paid verdict on the same order', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, orderId: 'order-1' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    try {
      await expect(
        verifyBnplSettlementProof({
          orderId: 'order-1',
          orderToken: 'tok-1',
          reference: 'ref-7',
        })
      ).resolves.toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/payments/verify?reference=ref-7&trackingToken=tok-1'
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('returns false for a non-success verdict or a foreign order', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            success: false,
            status: 'pending',
            orderId: 'order-1',
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, orderId: 'order-9' }),
      });
    vi.stubGlobal('fetch', mockFetch);

    try {
      await expect(
        verifyBnplSettlementProof({
          orderId: 'order-1',
          orderToken: 'tok-1',
          reference: 'ref-7',
        })
      ).resolves.toBe(false);
      await expect(
        verifyBnplSettlementProof({
          orderId: 'order-1',
          orderToken: 'tok-1',
          reference: 'ref-7',
        })
      ).resolves.toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('returns false when the verification transport fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network down'))
    );

    try {
      await expect(
        verifyBnplSettlementProof({
          orderId: 'order-1',
          orderToken: 'tok-1',
          reference: 'ref-7',
        })
      ).resolves.toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
