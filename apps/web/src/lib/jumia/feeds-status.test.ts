import { describe, expect, it, vi } from 'vitest';
import type { JumiaClient } from '@/lib/jumia/client';
import { updateStatus } from './feeds-status';

describe('updateStatus', () => {
  it('submits a validated status update', async () => {
    const request = vi.fn().mockResolvedValue({ feedId: 'FEED-STATUS' });
    const client = { request } as unknown as JumiaClient;

    await expect(
      updateStatus(client, [
        { sellerSku: 'SKU-1', id: 'PRODUCT-1', status: 'active' },
      ])
    ).resolves.toBe('FEED-STATUS');
    expect(request).toHaveBeenCalledWith(
      'POST',
      '/feeds/products/status',
      expect.anything(),
      {
        products: [{ sellerSku: 'SKU-1', id: 'PRODUCT-1', status: 'active' }],
      }
    );
  });

  it('rejects empty status updates before making a provider request', async () => {
    const request = vi.fn();
    const client = { request } as unknown as JumiaClient;

    await expect(updateStatus(client, [])).rejects.toThrow(
      'updates must be a non-empty array'
    );
    expect(request).not.toHaveBeenCalled();
  });
});
