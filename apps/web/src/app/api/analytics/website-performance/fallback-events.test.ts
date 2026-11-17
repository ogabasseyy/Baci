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

  it('caps rows at maxRows and sets truncated=true when +1 probe exceeds remaining', async () => {
    const rows = Array.from({ length: 11 }, (_, i) => ({
      event_type: 'search',
      event_data: { idx: i },
    }));
    const rangeMock = vi.fn().mockResolvedValue({ data: rows, error: null });
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
      10
    );

    expect(result).toEqual({
      rows: rows.slice(0, 10),
      truncated: true,
    });
    expect(rangeMock).toHaveBeenCalledWith(0, 10);
  });
});
