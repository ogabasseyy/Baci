import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fetchContext = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/merchant/fetch-dashboard-merchant-via-api', () => ({
  fetchDashboardMerchantViaApi: (...args: unknown[]) => fetchContext(...args),
}));

import { useSelectedAnalyticsMerchant } from './use-selected-analytics-merchant';

describe('useSelectedAnalyticsMerchant', () => {
  afterEach(() => vi.clearAllMocks());

  it('uses the selected merchant profile and its effective staff permissions', async () => {
    fetchContext.mockResolvedValueOnce({
      merchant: {
        id: 'merchant-b',
        business_name: 'Ghana Store',
        country: 'GH',
        payout_currency: 'GHS',
      },
      staffAccess: {
        isOwner: false,
        isStaff: true,
        permissions: {
          analytics: { view: true },
          products: { view: false },
        },
        role: 'marketing',
      },
    });
    const defaultHasPermission = vi.fn(() => true);

    const { result } = renderHook(() =>
      useSelectedAnalyticsMerchant({
        defaultHasPermission,
        defaultMerchant: { id: 'merchant-a', country: 'NG' } as never,
        requestedMerchantId: 'merchant-b',
      })
    );

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.merchant).toMatchObject({
      country: 'GH',
      id: 'merchant-b',
      payout_currency: 'GHS',
    });
    expect(result.current.hasPermission('analytics', 'view')).toBe(true);
    expect(result.current.hasPermission('products', 'view')).toBe(false);
    expect(defaultHasPermission).not.toHaveBeenCalled();
  });

  it('keeps the existing context when the callback merchant is already active', () => {
    const defaultHasPermission = vi.fn(() => false);
    const { result } = renderHook(() =>
      useSelectedAnalyticsMerchant({
        defaultHasPermission,
        defaultMerchant: { id: 'merchant-a', country: 'NG' } as never,
        requestedMerchantId: 'merchant-a',
      })
    );

    expect(result.current.loading).toBe(false);
    expect(result.current.merchant?.id).toBe('merchant-a');
    expect(result.current.hasPermission('products', 'view')).toBe(false);
    expect(fetchContext).not.toHaveBeenCalled();
  });

  it('surfaces an explicit error when a non-default merchant cannot be loaded', async () => {
    fetchContext.mockRejectedValueOnce(new Error('Forbidden'));
    const defaultHasPermission = vi.fn(() => true);
    const { result } = renderHook(() =>
      useSelectedAnalyticsMerchant({
        defaultHasPermission,
        defaultMerchant: { id: 'merchant-a', country: 'NG' } as never,
        requestedMerchantId: 'merchant-b',
      })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(
      'Unable to load the selected merchant. Please try again.'
    );
    expect(result.current.merchant).toBeNull();
    expect(result.current.hasPermission('integrations', 'manage')).toBe(false);
    expect(defaultHasPermission).not.toHaveBeenCalled();
  });
});
