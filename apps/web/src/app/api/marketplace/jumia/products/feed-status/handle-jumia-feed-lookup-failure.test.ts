import { beforeEach, describe, expect, it, vi } from 'vitest';

const { markMappingsAsPendingForManualResolution } = vi.hoisted(() => ({
  markMappingsAsPendingForManualResolution: vi.fn(),
}));
vi.mock('./jumia-feed-reconciliation', () => ({
  jumiaFeedReconciliation: { markMappingsAsPendingForManualResolution },
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
    markMappingsAsPendingForManualResolution.mockResolvedValueOnce(1);

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
  });

  it('continues without marking mappings for retryable lookup failures', async () => {
    const result = await handleJumiaFeedLookupFailure({
      error: new Error('temporarily unavailable'),
      feedId: 'feed-1',
      mappingsForFeed: [],
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
  });
});
