import { beforeEach, describe, expect, it, vi } from 'vitest';

const { markMappingsAsPendingForManualResolution, touchMappingsForFeedRetry } =
  vi.hoisted(() => ({
    markMappingsAsPendingForManualResolution: vi.fn(),
    touchMappingsForFeedRetry: vi.fn(),
  }));
vi.mock('./jumia-feed-reconciliation', () => ({
  jumiaFeedReconciliation: {
    markMappingsAsPendingForManualResolution,
    touchMappingsForFeedRetry,
  },
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('@/lib/jumia/client', () => ({
  JumiaApiError: class JumiaApiError extends Error {
    status: number;

    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

import { JumiaApiError } from '@/lib/jumia/client';
import { AMBIGUOUS_JUMIA_EXPORT_ERROR } from '../export/mark-ambiguous-jumia-export';
import { handleJumiaFeedLookupFailure } from './handle-jumia-feed-lookup-failure';

describe('handleJumiaFeedLookupFailure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preserves a missing feed as ambiguous and lets the batch continue', async () => {
    markMappingsAsPendingForManualResolution.mockResolvedValueOnce([
      { mappingId: 'mapping-1', sellerSku: 'SKU-1' },
    ]);

    const result = await handleJumiaFeedLookupFailure({
      error: new JumiaApiError(404, 'missing'),
      feedId: 'feed-1',
      mappingsForFeed: [
        {
          id: 'mapping-1',
          last_feed_id: 'feed-1',
          jumia_seller_sku: 'SKU-1',
          last_synced_at: null,
        },
      ],
      merchantId: 'merchant-1',
      supabase: {} as never,
    });

    expect(result).toEqual({
      kind: 'continue',
      failed: 0,
      status: 'NOT_FOUND',
      feedFailed: 0,
      preservedForManualResolution: [
        { mappingId: 'mapping-1', sellerSku: 'SKU-1' },
      ],
    });
    expect(markMappingsAsPendingForManualResolution).toHaveBeenCalledWith(
      expect.anything(),
      'merchant-1',
      expect.any(Array),
      AMBIGUOUS_JUMIA_EXPORT_ERROR
    );
    expect(touchMappingsForFeedRetry).not.toHaveBeenCalled();
  });

  it('reports only the mappings a concurrent poll did not already move', async () => {
    markMappingsAsPendingForManualResolution.mockResolvedValueOnce([]);
    const mappingsForFeed = [
      {
        id: 'mapping-1',
        last_feed_id: 'feed-1',
        jumia_seller_sku: 'SKU-1',
        last_synced_at: null,
      },
    ];

    const result = await handleJumiaFeedLookupFailure({
      error: new JumiaApiError(404, 'missing'),
      feedId: 'feed-1',
      mappingsForFeed,
      merchantId: 'merchant-1',
      supabase: {} as never,
    });

    expect(result).toEqual({
      kind: 'continue',
      failed: 0,
      status: 'NOT_FOUND',
      feedFailed: 0,
      preservedForManualResolution: [],
    });
  });

  it('rotates the retry window for retryable lookup failures', async () => {
    const mappingsForFeed = [
      {
        id: 'mapping-1',
        last_feed_id: 'feed-1',
        jumia_seller_sku: 'SKU-1',
        last_synced_at: null,
      },
    ];

    const result = await handleJumiaFeedLookupFailure({
      error: new Error('temporarily unavailable'),
      feedId: 'feed-1',
      mappingsForFeed,
      merchantId: 'merchant-1',
      supabase: {} as never,
    });

    expect(result).toEqual({
      kind: 'continue',
      failed: 0,
      status: 'ERROR',
      feedFailed: 0,
      preservedForManualResolution: [],
    });
    expect(markMappingsAsPendingForManualResolution).not.toHaveBeenCalled();
    expect(touchMappingsForFeedRetry).toHaveBeenCalledWith(
      expect.anything(),
      'merchant-1',
      mappingsForFeed
    );
  });
});
