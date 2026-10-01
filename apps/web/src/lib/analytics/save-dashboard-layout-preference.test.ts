import { describe, expect, it, vi } from 'vitest';

const mockFetchWithCsrf = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: mockFetchWithCsrf }));

import {
  fetchDashboardLayoutPreference,
  saveDashboardLayoutPreference,
} from './save-dashboard-layout-preference';

describe('saveDashboardLayoutPreference', () => {
  it('uses the CSRF-aware client for dashboard layout mutations', async () => {
    mockFetchWithCsrf.mockResolvedValue({ ok: true });
    const layout = [{ i: 'sales', x: 0, y: 0, w: 2, h: 2 }];

    await saveDashboardLayoutPreference(layout);

    expect(mockFetchWithCsrf).toHaveBeenCalledWith(
      '/api/dashboard/preferences',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ layout_config: layout }),
      })
    );
  });

  it('passes the selected merchant context with the layout mutation', async () => {
    mockFetchWithCsrf.mockResolvedValue({ ok: true });
    const layout = [{ i: 'sales', x: 0, y: 0, w: 2, h: 2 }];

    await saveDashboardLayoutPreference(layout, 'merchant-1');

    expect(mockFetchWithCsrf).toHaveBeenCalledWith(
      '/api/dashboard/preferences',
      expect.objectContaining({
        headers: {
          'Content-Type': 'application/json',
          'x-baci-merchant-id': 'merchant-1',
        },
      })
    );
  });

  it('persists responsive layouts instead of only the active breakpoint', async () => {
    mockFetchWithCsrf.mockResolvedValue({ ok: true });
    const responsiveLayouts = {
      lg: [{ i: 'sales', x: 0, y: 0, w: 2, h: 2 }],
      md: [{ i: 'sales', x: 0, y: 0, w: 5, h: 2 }],
    };

    await saveDashboardLayoutPreference(responsiveLayouts, 'merchant-1');

    expect(mockFetchWithCsrf).toHaveBeenCalledWith(
      '/api/dashboard/preferences',
      expect.objectContaining({
        body: JSON.stringify({ layout_config: responsiveLayouts }),
      })
    );
  });

  it('loads the selected merchant layout with an abort signal', async () => {
    const signal = new AbortController().signal;
    const json = vi.fn().mockResolvedValue({
      layout_config: { lg: [{ i: 'sales', x: 0, y: 0, w: 2, h: 2 }] },
    });
    mockFetchWithCsrf.mockResolvedValue({ ok: true, json });

    await expect(
      fetchDashboardLayoutPreference('merchant-1', signal)
    ).resolves.toEqual({ lg: [{ i: 'sales', x: 0, y: 0, w: 2, h: 2 }] });

    expect(mockFetchWithCsrf).toHaveBeenCalledWith(
      '/api/dashboard/preferences',
      {
        method: 'GET',
        headers: { 'x-baci-merchant-id': 'merchant-1' },
        signal,
      }
    );
  });

  it('preserves abort errors from layout hydration requests', async () => {
    const abortError = new DOMException(
      'The request was aborted',
      'AbortError'
    );
    mockFetchWithCsrf.mockRejectedValue(abortError);

    await expect(fetchDashboardLayoutPreference()).rejects.toBe(abortError);
  });

  it('rejects when the dashboard preference mutation fails', async () => {
    mockFetchWithCsrf.mockResolvedValue({ ok: false });

    await expect(
      saveDashboardLayoutPreference([{ i: 'sales', x: 0, y: 0, w: 2, h: 2 }])
    ).rejects.toThrow('Failed to save dashboard layout preference');
  });
});
