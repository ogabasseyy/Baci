import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useMerchantFeatures,
  useStorefrontFeatures,
} from './use-merchant-features';

describe('useStorefrontFeatures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('returns defaults when no merchantId or slug', () => {
    const { result } = renderHook(() => useStorefrontFeatures({}));
    expect(result.current.features.reviewsEnabled).toBe(true);
    expect(result.current.features.loyaltyEnabled).toBe(false);
    expect(result.current.features.shippingProviders).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it('fetches features when merchantId is provided', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          loyaltyEnabled: true,
          reviewsEnabled: false,
          wishlistEnabled: true,
          orderTrackingEnabled: true,
          discountCodesEnabled: true,
          guestCheckoutEnabled: true,
          shippingProviders: ['gigl'],
          freeShippingThreshold: 5000,
          collectPhone: true,
          requireAccount: false,
          showOrderNotes: true,
          pages: {
            about: true,
            contact: true,
            faq: true,
            privacy: true,
            terms: true,
            rewards: true,
          },
          showRecentPurchases: false,
          showStockLevels: true,
          lowStockThreshold: 10,
          hasGoogleAnalytics: false,
          hasFacebookPixel: false,
          hasTiktokPixel: false,
        }),
    } as Response);

    const { result } = renderHook(() =>
      useStorefrontFeatures({ merchantId: 'merchant-1' })
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.isLoyaltyEnabled).toBe(true);
  });
});

describe('use-merchant-features exports', () => {
  it('keeps the dashboard hook available from the established module path', () => {
    expect(useMerchantFeatures).toBeTypeOf('function');
  });
});
