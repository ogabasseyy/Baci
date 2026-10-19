import { afterEach, describe, expect, it, vi } from 'vitest';

const mockFetchWithCsrf = vi.fn();

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: (...args: unknown[]) => mockFetchWithCsrf(...args),
}));

import { loadSystemHealth, reloadLiveAnalytics } from './system-health-data';

describe('system health data', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    mockFetchWithCsrf.mockReset();
  });

  it('returns an error instead of accepting an invalid health response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({ checkedAt: 'not-a-date' }),
        ok: true,
      })
    );

    await expect(
      loadSystemHealth(new AbortController().signal)
    ).resolves.toMatchObject({
      status: 'error',
    });
  });

  it('uses a CSRF-aware request when reloading live analytics', async () => {
    mockFetchWithCsrf.mockResolvedValue({ ok: true });

    await expect(reloadLiveAnalytics()).resolves.toEqual({ status: 'ok' });
    expect(mockFetchWithCsrf).toHaveBeenCalledWith('/api/admin/analytics', {
      method: 'POST',
    });
  });
});
