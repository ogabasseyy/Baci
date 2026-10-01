import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAnalyticsGridLayout } from './use-analytics-grid-layout';

const fetchPreference = vi.hoisted(() => vi.fn());
const savePreference = vi.hoisted(() => vi.fn());
vi.mock('@/lib/analytics/save-dashboard-layout-preference', () => ({
  fetchDashboardLayoutPreference: (...args: unknown[]) =>
    fetchPreference(...args),
  saveDashboardLayoutPreference: (...args: unknown[]) =>
    savePreference(...args),
}));

describe('useAnalyticsGridLayout', () => {
  beforeEach(() => {
    fetchPreference.mockReset();
    savePreference.mockReset();
    fetchPreference.mockResolvedValue(null);
    savePreference.mockResolvedValue(undefined);
  });

  it('hydrates per merchant and queues edit-mode layout saves', async () => {
    const { result } = renderHook(() =>
      useAnalyticsGridLayout({
        activeCategory: 'overview',
        isEditMode: true,
        merchantId: 'merchant-1',
      })
    );

    await waitFor(() => expect(fetchPreference).toHaveBeenCalled());
    act(() => {
      result.current.onLayoutChange([], {
        lg: [{ i: 'summary-revenue', x: 0, y: 0, w: 4, h: 1 }],
      });
    });
    await waitFor(() =>
      expect(savePreference).toHaveBeenCalledWith(
        expect.any(Object),
        'merchant-1',
        expect.any(AbortSignal)
      )
    );
  });

  it('waits for preference hydration before saving an early edit', async () => {
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
      result.current.onLayoutChange([], {
        lg: [
          {
            h: 2,
            i: 'summary-revenue',
            w: 4,
            x: 5,
            y: 1,
          },
        ],
      });
    });
    expect(savePreference).not.toHaveBeenCalled();

    resolvePreference?.({
      finance: {
        lg: [
          {
            h: 1,
            i: 'summary-profit',
            w: 4,
            x: 0,
            y: 0,
          },
        ],
      },
      overview: {
        lg: [
          {
            h: 1,
            i: 'analytics-highlights',
            w: 8,
            x: 0,
            y: 0,
          },
        ],
      },
    });

    await waitFor(() => expect(savePreference).toHaveBeenCalledTimes(1));
    const savedConfig = savePreference.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(savedConfig).toHaveProperty('finance');
    expect(savedConfig).toHaveProperty('overview');
    expect(result.current.layouts.lg).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ i: 'summary-revenue', x: 5, y: 1 }),
      ])
    );
  });

  it('does not overwrite saved categories when preference hydration fails', async () => {
    let rejectPreference: ((error: unknown) => void) | undefined;
    fetchPreference.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectPreference = reject;
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
      result.current.onLayoutChange([], {
        lg: [
          {
            h: 2,
            i: 'summary-revenue',
            w: 4,
            x: 5,
            y: 1,
          },
        ],
      });
    });
    expect(savePreference).not.toHaveBeenCalled();

    await act(async () => {
      rejectPreference?.(new Error('preference read failed'));
    });

    await waitFor(() => expect(rejectPreference).toBeDefined());
    expect(savePreference).not.toHaveBeenCalled();

    // The edit remains local, but no write is attempted without a known
    // baseline for the other saved categories.
    expect(result.current.layouts.lg).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ i: 'summary-revenue', x: 5, y: 1 }),
      ])
    );
  });
});
