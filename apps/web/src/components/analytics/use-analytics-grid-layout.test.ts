import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveCategoryLayouts } from './analytics-grid-layouts';

const { enqueue, fetchPreference, reset } = vi.hoisted(() => ({
  enqueue: vi.fn().mockResolvedValue(undefined),
  fetchPreference: vi.fn().mockResolvedValue(null),
  reset: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/analytics/dashboard-layout-save-queue', () => ({
  createDashboardLayoutSaveQueue: () => ({ enqueue, reset }),
}));
vi.mock('@/lib/analytics/save-dashboard-layout-preference', () => ({
  fetchDashboardLayoutPreference: fetchPreference,
  saveDashboardLayoutPreference: vi.fn(),
}));

import { useAnalyticsGridLayout } from './use-analytics-grid-layout';

describe('useAnalyticsGridLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchPreference.mockResolvedValue(null);
    enqueue.mockResolvedValue(undefined);
    reset.mockResolvedValue(undefined);
  });

  it('updates the local layout without persisting outside edit mode', () => {
    const { result } = renderHook(() =>
      useAnalyticsGridLayout({
        activeCategory: 'overview',
        isEditMode: false,
        merchantId: 'merchant-1',
      })
    );

    act(() => {
      result.current.onLayoutChange([], { lg: [] });
    });

    expect(result.current.layouts.lg).toEqual([]);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('queues merchant-scoped persistence while editing', async () => {
    const { result } = renderHook(() =>
      useAnalyticsGridLayout({
        activeCategory: 'overview',
        isEditMode: true,
        merchantId: 'merchant-1',
      })
    );

    await waitFor(() => expect(fetchPreference).toHaveBeenCalled());
    act(() => {
      result.current.onLayoutChange([], { lg: [] });
    });

    await waitFor(() =>
      expect(enqueue).toHaveBeenCalledWith(expect.any(Object), 'merchant-1')
    );
  });

  it('does not persist a default layout callback before hydration', async () => {
    let resolvePreference: ((layoutConfig: unknown) => void) | undefined;
    fetchPreference.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePreference = resolve;
        })
    );

    const { result } = renderHook(() =>
      useAnalyticsGridLayout({
        activeCategory: 'overview',
        isEditMode: true,
        merchantId: 'merchant-1',
      })
    );

    await waitFor(() => expect(fetchPreference).toHaveBeenCalled());
    act(() => {
      result.current.onLayoutChange([], resolveCategoryLayouts('overview'));
    });
    expect(enqueue).not.toHaveBeenCalled();

    await act(async () => {
      resolvePreference?.(null);
    });

    expect(enqueue).not.toHaveBeenCalled();
  });
});
