import { waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPublicClient } from '@/lib/supabase/public';

const mockAfter = vi.fn();
const mockLoggerWarn = vi.fn();
const mockAnalyticsInsert = vi.fn().mockResolvedValue({ error: null });
const mockAnalyticsSupabase = {
  from: vi.fn(() => ({
    insert: mockAnalyticsInsert,
  })),
};

vi.mock('next/server', () => ({
  after: (...args: unknown[]) => mockAfter(...args),
}));

vi.mock('@/lib/supabase/public', () => ({
  createPublicClient: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
  },
}));

const { scheduleSearchAnalyticsInsert } = await import(
  './storefront-search-analytics'
);

const SUBMISSION = {
  merchantId: '123e4567-e89b-12d3-a456-426614174000',
  query: 'iphone',
  resultsCount: 45,
};

function flushAfterCallbacks() {
  const callbacks = mockAfter.mock.calls.map((call) => call[0]) as Array<
    () => Promise<void>
  >;
  return Promise.all(callbacks.map((callback) => callback()));
}

describe('scheduleSearchAnalyticsInsert', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks keeps implementations: drop the per-test after()
    // behaviors so each case starts from a recording no-op.
    mockAfter.mockReset();
    mockAnalyticsInsert.mockResolvedValue({ error: null });
    vi.mocked(createPublicClient).mockReturnValue(
      mockAnalyticsSupabase as never
    );
  });

  it('schedules the submission insert after the response', async () => {
    scheduleSearchAnalyticsInsert(SUBMISSION);

    expect(mockAfter).toHaveBeenCalledTimes(1);
    expect(createPublicClient).toHaveBeenCalledWith({
      clientInfo: 'baci-storefront-search-analytics',
    });
    expect(mockAnalyticsInsert).not.toHaveBeenCalled();

    await flushAfterCallbacks();

    expect(mockAnalyticsSupabase.from).toHaveBeenCalledWith('search_analytics');
    expect(mockAnalyticsInsert).toHaveBeenCalledTimes(1);
    expect(mockAnalyticsInsert).toHaveBeenCalledWith({
      merchant_id: SUBMISSION.merchantId,
      search_query: SUBMISSION.query,
      results_count: SUBMISSION.resultsCount,
      search_method: 'server',
    });
  });

  it('reuses a provided supabase client instead of creating one', async () => {
    scheduleSearchAnalyticsInsert({
      ...SUBMISSION,
      supabase: mockAnalyticsSupabase,
    });

    expect(createPublicClient).not.toHaveBeenCalled();

    await flushAfterCallbacks();

    expect(mockAnalyticsInsert).toHaveBeenCalledTimes(1);
  });

  it('runs the insert inline outside a request scope', async () => {
    mockAfter.mockImplementation(() => {
      throw new Error('after() called outside a request scope');
    });

    scheduleSearchAnalyticsInsert(SUBMISSION);

    // The fallback executes without awaiting.
    await waitFor(() => {
      expect(mockAnalyticsInsert).toHaveBeenCalledTimes(1);
    });
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  it('rethrows request-scope errors that are not scope violations', () => {
    mockAfter.mockImplementation(() => {
      throw new Error('after() exploded');
    });

    expect(() => scheduleSearchAnalyticsInsert(SUBMISSION)).toThrow(
      'after() exploded'
    );
    expect(mockAnalyticsInsert).not.toHaveBeenCalled();
  });

  it('warns without throwing when the insert reports an error', async () => {
    mockAnalyticsInsert.mockResolvedValueOnce({
      error: { message: 'insert rejected' },
    });

    scheduleSearchAnalyticsInsert(SUBMISSION);
    await flushAfterCallbacks();

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Storefront search analytics insert failed',
      })
    );
  });

  it('warns without throwing when the insert itself throws', async () => {
    mockAnalyticsInsert.mockRejectedValueOnce(new Error('connection lost'));

    scheduleSearchAnalyticsInsert(SUBMISSION);
    await flushAfterCallbacks();

    expect(mockAnalyticsInsert).toHaveBeenCalledTimes(1);
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Storefront search analytics insert failed',
      })
    );
  });
});
