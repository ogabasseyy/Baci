import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { fetchFallbackAnalyticsEvents } from './fallback-events';

describe('fetchFallbackAnalyticsEvents', () => {
  it('returns rows and truncated=false when total rows fit within maxRows', async () => {
    const rangeMock = vi.fn().mockResolvedValue({
      data: [{ event_type: 'search', event_data: {} }],
      error: null,
    });
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: rangeMock,
    };
    const supabase = {
      from: vi.fn().mockReturnValue(chain),
    } as unknown as SupabaseClient;

    const result = await fetchFallbackAnalyticsEvents(
      supabase,
      'm1',
      '2026-01-01',
      '2026-01-31',
      500
    );

    expect(result).toEqual({
      rows: [{ event_type: 'search', event_data: {} }],
      truncated: false,
    });
    expect(rangeMock).toHaveBeenCalledWith(0, 500);
  });
});
