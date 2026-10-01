'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { fetchWithCsrf } from '@/lib/api-client';

/** Full merchant feature settings used by the dashboard. */
export interface MerchantFeatureSettings {
  id: string;
  merchant_id: string;
  loyalty_enabled: boolean;
  reviews_enabled: boolean;
  wishlist_enabled: boolean;
  order_tracking_enabled: boolean;
  discount_codes_enabled: boolean;
  guest_checkout_enabled: boolean;
  shipping_providers: string[];
  free_shipping_threshold: number | null;
  shipping_markup_percentage: number;
  checkout_collect_phone: boolean;
  checkout_require_account: boolean;
  checkout_show_order_notes: boolean;
  about_page_enabled: boolean;
  contact_page_enabled: boolean;
  faq_page_enabled: boolean;
  privacy_page_enabled: boolean;
  terms_page_enabled: boolean;
  rewards_page_enabled: boolean;
  show_recent_purchases: boolean;
  show_stock_levels: boolean;
  low_stock_threshold: number;
  google_analytics_id: string | null;
  facebook_pixel_id: string | null;
  tiktok_pixel_id: string | null;
  auto_generate_schema: boolean;
  custom_robots_txt: string | null;
  blog_enabled: boolean;
  auto_blog_enabled: boolean;
  google_reviews_enabled: boolean;
  google_place_id: string | null;
  email_notifications_enabled: boolean;
  sms_notifications_enabled: boolean;
  shipping_insurance_enabled: boolean;
  shipping_insurance_min_order_value: number | null;
  shipping_insurance_opt_in_default: boolean;
  custom_settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

type MerchantSettingsResult =
  | { ok: true; settings: MerchantFeatureSettings }
  | { ok: false; error: string };

async function fetchMerchantSettings(
  merchantId: string
): Promise<MerchantSettingsResult> {
  try {
    const response = await fetch(
      `/api/merchant/features?${new URLSearchParams({ merchantId })}`
    );
    const result = await response.json();

    if (!response.ok) {
      return { ok: false, error: result.error || 'Failed to fetch settings' };
    }

    return { ok: true, settings: result };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to fetch settings',
    };
  }
}

async function patchMerchantSettings(
  merchantId: string,
  updates: Partial<MerchantFeatureSettings>
): Promise<MerchantSettingsResult> {
  try {
    const response = await fetchWithCsrf('/api/merchant/features', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...updates, merchantId }),
    });
    const result = await response.json();

    if (!response.ok) {
      return { ok: false, error: result.error || 'Failed to update settings' };
    }

    return { ok: true, settings: result };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to update settings',
    };
  }
}

/** Manages merchant-scoped dashboard feature settings. */
export function useMerchantFeatures(merchantId: string) {
  const [settings, setSettings] = useState<MerchantFeatureSettings | null>(
    null
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stateMerchantId, setStateMerchantId] = useState(merchantId);
  const activeMerchantIdRef = useRef(merchantId);
  const settingsRequestGenerationRef = useRef(0);
  const fetchGenerationRef = useRef(0);
  const updateGenerationRef = useRef(0);

  if (stateMerchantId !== merchantId) {
    setStateMerchantId(merchantId);
    setSettings(null);
    setIsLoading(true);
    setIsSaving(false);
    setError(null);
  }

  useLayoutEffect(() => {
    activeMerchantIdRef.current = merchantId;
    settingsRequestGenerationRef.current += 1;
    fetchGenerationRef.current += 1;
    updateGenerationRef.current += 1;
  }, [merchantId]);

  const fetchSettings = async () => {
    const requestedMerchantId = merchantId;
    const requestGeneration = ++settingsRequestGenerationRef.current;
    const fetchGeneration = ++fetchGenerationRef.current;
    setIsLoading(true);
    setError(null);

    const result = await fetchMerchantSettings(requestedMerchantId);
    if (activeMerchantIdRef.current !== requestedMerchantId) return;
    if (settingsRequestGenerationRef.current === requestGeneration) {
      if (result.ok) {
        setSettings(result.settings);
      } else {
        setError(result.error);
      }
    }
    if (fetchGenerationRef.current === fetchGeneration) {
      setIsLoading(false);
    }
  };

  const updateSettings = async (
    updates: Partial<MerchantFeatureSettings>
  ): Promise<boolean> => {
    const requestedMerchantId = merchantId;
    const requestGeneration = ++settingsRequestGenerationRef.current;
    const updateGeneration = ++updateGenerationRef.current;
    setIsSaving(true);
    setError(null);

    const result = await patchMerchantSettings(requestedMerchantId, updates);
    if (activeMerchantIdRef.current !== requestedMerchantId) return false;
    const isLatestRequest =
      settingsRequestGenerationRef.current === requestGeneration;
    const isLatestUpdate = updateGenerationRef.current === updateGeneration;
    if (isLatestRequest) {
      if (result.ok) {
        setSettings(result.settings);
      } else {
        setError(result.error);
      }
    }
    if (isLatestUpdate) {
      setIsSaving(false);
    }
    return isLatestRequest && isLatestUpdate && result.ok;
  };

  const toggleFeature = async (
    feature: keyof MerchantFeatureSettings
  ): Promise<boolean> => {
    await Promise.resolve();
    if (!settings || typeof settings[feature] !== 'boolean') return false;
    return updateSettings({ [feature]: !settings[feature] });
  };

  useEffect(() => {
    let cancelled = false;
    const requestedMerchantId = merchantId;
    const requestGeneration = ++settingsRequestGenerationRef.current;
    const fetchGeneration = ++fetchGenerationRef.current;

    fetchMerchantSettings(requestedMerchantId).then((result) => {
      if (cancelled || activeMerchantIdRef.current !== requestedMerchantId) {
        return;
      }
      if (settingsRequestGenerationRef.current === requestGeneration) {
        if (result.ok) {
          setSettings(result.settings);
          setError(null);
        } else {
          setError(result.error);
        }
      }
      if (fetchGenerationRef.current === fetchGeneration) {
        setIsLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [merchantId]);

  return {
    settings,
    isLoading,
    isSaving,
    error,
    refresh: fetchSettings,
    updateSettings,
    toggleFeature,
    loyaltyEnabled: settings?.loyalty_enabled ?? false,
    reviewsEnabled: settings?.reviews_enabled ?? true,
    wishlistEnabled: settings?.wishlist_enabled ?? true,
    orderTrackingEnabled: settings?.order_tracking_enabled ?? true,
    discountCodesEnabled: settings?.discount_codes_enabled ?? true,
    guestCheckoutEnabled: settings?.guest_checkout_enabled ?? true,
    shippingProviders: settings?.shipping_providers ?? [],
    freeShippingThreshold: settings?.free_shipping_threshold ?? null,
    blogEnabled: settings?.blog_enabled ?? false,
    autoBlogEnabled: settings?.auto_blog_enabled ?? false,
    googleReviewsEnabled: settings?.google_reviews_enabled ?? false,
    googlePlaceId: settings?.google_place_id ?? null,
    shippingInsuranceEnabled: settings?.shipping_insurance_enabled ?? false,
    shippingInsuranceMinOrderValue:
      settings?.shipping_insurance_min_order_value ?? 5000,
    shippingInsuranceOptInDefault:
      settings?.shipping_insurance_opt_in_default ?? false,
  };
}
