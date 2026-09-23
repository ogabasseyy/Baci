import { useQuery } from '@tanstack/react-query';
import { parseShippingSettings } from '@/components/shipping/shipping-types';
import { isGiglAdminShippingEligible } from '@/lib/order-gigl-eligibility';
import { supabase } from '@/lib/supabase';

const DEFAULT_SHIPPING_PROVIDERS = ['gigl', 'topship'] as const;

interface MerchantEligibilityInput {
  country?: string | null;
  id?: string | null;
  payout_currency?: string | null;
}

export function useGiglAdminShippingEligibility(
  merchant: MerchantEligibilityInput | null | undefined
) {
  const shippingSettingsQuery = useQuery({
    queryKey: ['shipping-settings', merchant?.id, 'gigl-eligibility'],
    queryFn: async () => {
      if (!merchant?.id) {
        throw new Error('Merchant is required');
      }

      const { data, error } = await supabase
        .from('merchant_feature_settings')
        .select('merchant_id, shipping_providers, free_shipping_threshold')
        .eq('merchant_id', merchant.id)
        .maybeSingle();

      if (error) {
        throw error;
      }

      if (!data) {
        return {
          merchant_id: merchant.id,
          shipping_providers: [...DEFAULT_SHIPPING_PROVIDERS],
          free_shipping_threshold: null,
        };
      }

      if (data.shipping_providers == null) {
        return parseShippingSettings({
          ...data,
          shipping_providers: [...DEFAULT_SHIPPING_PROVIDERS],
        });
      }

      return parseShippingSettings(data);
    },
    enabled: Boolean(merchant?.id),
    staleTime: 1000 * 60 * 5,
  });

  const settingsReady =
    Boolean(merchant?.id) &&
    !shippingSettingsQuery.isLoading &&
    !shippingSettingsQuery.isError &&
    Boolean(shippingSettingsQuery.data);

  return {
    isEligible: isGiglAdminShippingEligible({
      country: merchant?.country,
      payoutCurrency: merchant?.payout_currency,
      settingsReady,
      shippingProviders: shippingSettingsQuery.data?.shipping_providers,
    }),
    isError: shippingSettingsQuery.isError,
    isLoading: shippingSettingsQuery.isLoading,
  };
}
