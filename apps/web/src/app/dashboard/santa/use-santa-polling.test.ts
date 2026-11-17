// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
});
