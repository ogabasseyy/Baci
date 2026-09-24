import { describe, expect, it, vi } from 'vitest';
import { jumiaFeedReconciliation } from './jumia-feed-reconciliation';

describe('jumiaFeedReconciliation', () => {
  it('uses the sole null-SKU mapping only for a single feed item', () => {
    const mapping = {
      id: 'mapping-1',
      last_feed_id: 'feed-1',
      jumia_seller_sku: null,
      last_synced_at: null,
    };

    expect(
      jumiaFeedReconciliation.findMappingForFeedItem([mapping], 'SKU-1', 1)
    ).toBe(mapping);
    expect(
      jumiaFeedReconciliation.findMappingForFeedItem([mapping], 'SKU-1', 2)
    ).toBeUndefined();
  });

  it('fails when a rejected mapping cannot be persisted', async () => {
    const builder = {
      update: vi.fn(),
      eq: vi.fn(),
    };
    builder.update.mockReturnValue(builder);
    builder.eq.mockReturnValueOnce(builder).mockResolvedValueOnce({
      error: { message: 'write failed' },
    });
    const supabase = { from: vi.fn(() => builder) };

    await expect(
      jumiaFeedReconciliation.markMappingsAsFeedError(
        supabase as never,
        'merchant-1',
        [
          {
            id: 'mapping-1',
            last_feed_id: 'feed-1',
            jumia_seller_sku: 'SKU-1',
            last_synced_at: null,
          },
        ],
        'Rejected'
      )
    ).rejects.toThrow('Failed to mark rejected Jumia feed mapping');
  });

  it('keeps unmatched terminal-feed mappings pending for manual resolution', async () => {
    const update = vi.fn();
    const eq = vi.fn();
    const builder = {
      update,
      eq,
      is: vi.fn(),
      select: vi.fn(),
      maybeSingle: vi.fn(),
    };
    builder.update.mockReturnValue(builder);
    builder.eq.mockReturnValue(builder);
    builder.select.mockReturnValue(builder);
    builder.maybeSingle.mockResolvedValue({
      data: { id: 'mapping-1' },
      error: null,
    });
    const supabase = { from: vi.fn(() => builder) };

    await expect(
      jumiaFeedReconciliation.markMappingsAsPendingForManualResolution(
        supabase as never,
        'merchant-1',
        [
          {
            id: 'mapping-1',
            last_feed_id: 'feed-1',
            jumia_seller_sku: 'SKU-1',
            last_synced_at: null,
          },
        ],
        'manual resolution required'
      )
    ).resolves.toEqual([{ mappingId: 'mapping-1', sellerSku: 'SKU-1' }]);
    expect(update).toHaveBeenCalledWith({
      sync_status: 'pending',
      sync_error: 'manual resolution required',
      last_feed_id: null,
      last_synced_at: expect.any(String),
    });
    expect(eq).toHaveBeenCalledWith('sync_status', 'pending');
    expect(eq).toHaveBeenCalledWith('last_feed_id', 'feed-1');
  });

  it('skips manual-resolution downgrades a concurrent poll already moved', async () => {
    const builder = {
      update: vi.fn(),
      eq: vi.fn(),
      is: vi.fn(),
      select: vi.fn(),
      maybeSingle: vi.fn(),
    };
    builder.update.mockReturnValue(builder);
    builder.eq.mockReturnValue(builder);
    builder.select.mockReturnValue(builder);
    builder.maybeSingle.mockResolvedValue({ data: null, error: null });
    const supabase = { from: vi.fn(() => builder) };

    await expect(
      jumiaFeedReconciliation.markMappingsAsPendingForManualResolution(
        supabase as never,
        'merchant-1',
        [
          {
            id: 'mapping-1',
            last_feed_id: 'feed-1',
            jumia_seller_sku: 'SKU-1',
            last_synced_at: null,
          },
        ],
        'manual resolution required'
      )
    ).resolves.toEqual([]);
  });

  it('rotates the retry window without failing the batch on write errors', async () => {
    const update = vi.fn();
    const builder = {
      update,
      in: vi.fn(),
      eq: vi.fn(),
    };
    builder.update.mockReturnValue(builder);
    builder.in.mockReturnValue(builder);
    builder.eq.mockResolvedValue({ error: { message: 'write failed' } });
    const supabase = { from: vi.fn(() => builder) };

    await expect(
      jumiaFeedReconciliation.touchMappingsForFeedRetry(
        supabase as never,
        'merchant-1',
        [
          {
            id: 'mapping-1',
            last_feed_id: 'feed-1',
            jumia_seller_sku: 'SKU-1',
            last_synced_at: null,
          },
        ]
      )
    ).resolves.toBeUndefined();
    expect(update).toHaveBeenCalledWith({
      last_synced_at: expect.any(String),
    });
    expect(builder.in).toHaveBeenCalledWith('id', ['mapping-1']);
  });
});
