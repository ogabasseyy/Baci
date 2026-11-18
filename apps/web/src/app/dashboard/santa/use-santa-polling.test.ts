// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetSantaStats = vi.fn();
const mockGetRecentInteractions = vi.fn();

vi.mock('./actions', () => ({
  getSantaStats: (...args: unknown[]) => mockGetSantaStats(...args),
  getRecentInteractions: (...args: unknown[]) =>
    mockGetRecentInteractions(...args),
}));

import { useSantaPolling } from './use-santa-polling';

describe('useSantaPolling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads stats and interactions and clears loading state', async () => {
    mockGetSantaStats.mockResolvedValue({ totalRevenue: 100 });
    mockGetRecentInteractions.mockResolvedValue([]);

    const { result } = renderHook(() => useSantaPolling('merchant-1'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.stats).toEqual({ totalRevenue: 100 });
    expect(result.current.pollError).toBeNull();
  });

  it('pauses after three stalled ticks and restarts on restartPolling', async () => {
    vi.useFakeTimers();
    mockGetSantaStats.mockImplementation(() => new Promise(() => {}));
    mockGetRecentInteractions.mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useSantaPolling('merchant-1'));

    // Three 30s interval ticks while initial request is still pending -> paused.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(90_000);
    });

    expect(result.current.pollingPaused).toBe(true);
    expect(result.current.pollError).toBe(
      'Unable to refresh live campaign stats.'
    );

    mockGetSantaStats.mockResolvedValue({ totalRevenue: 250 });
    mockGetRecentInteractions.mockResolvedValue([]);

    await act(async () => {
      result.current.restartPolling();
      await Promise.resolve();
    });

    expect(result.current.pollingPaused).toBe(false);
    expect(result.current.pollError).toBeNull();
    expect(result.current.stats).toEqual({ totalRevenue: 250 });
  });
});
