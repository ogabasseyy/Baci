import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { loadSystemHealth, reloadLiveAnalytics } = vi.hoisted(() => ({
  loadSystemHealth: vi.fn(),
  reloadLiveAnalytics: vi.fn(),
}));

vi.mock('./system-health-data', () => ({
  loadSystemHealth,
  reloadLiveAnalytics,
}));

import { useSystemHealth } from './use-system-health';

const health = {
  checkedAt: '2026-06-11T00:00:00.000Z',
  health: [],
  indexRecommendations: [],
  missingIndexes: [],
};

describe('useSystemHealth', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    loadSystemHealth.mockReset();
    reloadLiveAnalytics.mockReset();
  });

  it('loads the verified system health on mount', async () => {
    loadSystemHealth.mockResolvedValue({ status: 'ok', data: health });
    const toast = vi.fn();
    const { result } = renderHook(() => useSystemHealth(toast));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.health).toEqual(health);
    expect(result.current.loadError).toBeNull();
    expect(loadSystemHealth).toHaveBeenCalledWith(expect.any(AbortSignal));
  });

  it('fails closed with an explicit unknown-health message when loading fails', async () => {
    const error = new Error('network unavailable');
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    loadSystemHealth.mockResolvedValue({ status: 'error', error });
    const toast = vi.fn();
    const { result } = renderHook(() => useSystemHealth(toast));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.health).toBeNull();
    expect(result.current.loadError).toContain('could not be verified');
    expect(toast).toHaveBeenCalledWith({
      title: 'Error',
      description: 'Failed to load system health data.',
      variant: 'destructive',
    });
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to fetch system health:',
      error
    );
  });

  it('reports failed analytics reloads and clears the operation state', async () => {
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    loadSystemHealth.mockResolvedValue({ status: 'aborted' });
    const error = new Error('reload failed');
    reloadLiveAnalytics.mockResolvedValue({ status: 'error', error });
    const toast = vi.fn();
    const { result } = renderHook(() => useSystemHealth(toast));

    await act(async () => {
      result.current.reloadAnalytics();
    });

    expect(result.current.reloadingAnalytics).toBe(false);
    expect(toast).toHaveBeenCalledWith({
      title: 'Error',
      description: 'Failed to reload live analytics.',
      variant: 'destructive',
    });
    expect(errorSpy).toHaveBeenCalledWith('Failed to reload analytics:', error);
  });
});
