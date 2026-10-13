'use client';

import { useEffect, useState } from 'react';

export {
  type MerchantFeatureSettings,
  useMerchantFeatures,
} from './use-merchant-feature-settings';

/**
 * Storefront Feature Settings (Public)
 */
export interface StorefrontFeatures {
  loyaltyEnabled: boolean;
  reviewsEnabled: boolean;
  wishlistEnabled: boolean;
  orderTrackingEnabled: boolean;
  discountCodesEnabled: boolean;
  guestCheckoutEnabled: boolean;
  shippingProviders: string[];
  freeShippingThreshold: number | null;
  collectPhone: boolean;
  requireAccount: boolean;
  showOrderNotes: boolean;
  pages: {
    about: boolean;
    contact: boolean;
    faq: boolean;
    privacy: boolean;
    terms: boolean;
    rewards: boolean;
  };
  showRecentPurchases: boolean;
  showStockLevels: boolean;
  lowStockThreshold: number;
  hasGoogleAnalytics: boolean;
  hasFacebookPixel: boolean;
  hasTiktokPixel: boolean;
  repairsCatalogEnabled: boolean;
}

// Default features for storefront
const DEFAULT_STOREFRONT_FEATURES: StorefrontFeatures = {
  loyaltyEnabled: false,
  reviewsEnabled: true,
  wishlistEnabled: true,
  orderTrackingEnabled: true,
  discountCodesEnabled: true,
  guestCheckoutEnabled: true,
  shippingProviders: [],
  freeShippingThreshold: null,
  collectPhone: true,
  requireAccount: false,
  showOrderNotes: true,
  pages: {
    about: true,
    contact: true,
    faq: true,
    privacy: true,
    terms: true,
    rewards: false,
  },
  showRecentPurchases: false,
  showStockLevels: true,
  lowStockThreshold: 10,
  hasGoogleAnalytics: false,
  hasFacebookPixel: false,
  hasTiktokPixel: false,
  repairsCatalogEnabled: false,
};

interface UseStorefrontFeaturesOptions {
  merchantId?: string;
  slug?: string;
  autoFetch?: boolean;
}

type StorefrontFeaturesResult =
  | { ok: true; features: StorefrontFeatures }
  | { ok: false; error: string };

/**
 * Module-scope fetch helper. Keeping the try/catch/finally control flow out of
 * the hook body (and out of the effect's synchronous path) lets React Compiler
 * memoize the hook: it cannot lower try/finally, and synchronous setState in an
 * effect triggers cascading renders.
 */
async function fetchStorefrontFeatures(
  merchantId?: string,
  slug?: string
): Promise<StorefrontFeaturesResult> {
  try {
    const params = new URLSearchParams();
    if (merchantId) params.set('merchantId', merchantId);
    if (slug) params.set('slug', slug);

    const response = await fetch(`/api/storefront/features?${params}`);
    const result = await response.json();

    if (!response.ok) {
      return { ok: false, error: result.error || 'Failed to fetch features' };
    }

    return { ok: true, features: result };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to fetch features',
    };
  }
}

/**
 * Hook for storefront to get public feature settings
 */
export function useStorefrontFeatures({
  merchantId,
  slug,
  autoFetch = true,
}: UseStorefrontFeaturesOptions) {
  const [features, setFeatures] = useState<StorefrontFeatures>(
    DEFAULT_STOREFRONT_FEATURES
  );
  // Initialise loading to reflect whether an auto-fetch will run, so the effect
  // never needs a synchronous setIsLoading(true).
  const [isLoading, setIsLoading] = useState(
    () => autoFetch && Boolean(merchantId || slug)
  );
  const [error, setError] = useState<string | null>(null);

  const fetchFeatures = async () => {
    if (!merchantId && !slug) return;

    setIsLoading(true);
    setError(null);

    const result = await fetchStorefrontFeatures(merchantId, slug);
    if (result.ok) {
      setFeatures(result.features);
    } else {
      setFeatures(DEFAULT_STOREFRONT_FEATURES);
      setError(result.error);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    if (!(autoFetch && (merchantId || slug))) {
      return;
    }

    let cancelled = false;

    fetchStorefrontFeatures(merchantId, slug).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setFeatures(result.features);
        setError(null);
      } else {
        setFeatures(DEFAULT_STOREFRONT_FEATURES);
        setError(result.error);
      }
      setIsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [autoFetch, merchantId, slug]);

  return {
    features,
    isLoading,
    error,
    refresh: fetchFeatures,

    // Convenience accessors
    isLoyaltyEnabled: features.loyaltyEnabled,
    isReviewsEnabled: features.reviewsEnabled,
    isWishlistEnabled: features.wishlistEnabled,
    isOrderTrackingEnabled: features.orderTrackingEnabled,
    isDiscountCodesEnabled: features.discountCodesEnabled,
    isGuestCheckoutEnabled: features.guestCheckoutEnabled,
    isRepairsCatalogEnabled: features.repairsCatalogEnabled,
    pages: features.pages,
    shippingProviders: features.shippingProviders,
    freeShippingThreshold: features.freeShippingThreshold,
  };
}
