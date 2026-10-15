import type { PaymentSettings } from '@/hooks/useMerchantPaymentSettings';
import { merchantPaymentSettingsQueryKey } from '@/hooks/useMerchantPaymentSettings';
import { CONFIG } from '@/lib/config';
import { queryClient } from '@/lib/query-client';

type NativeAssurancePolicy = {
  smartCartProEnabled: boolean;
  merchantSlug: string | null | undefined;
  shippingInsuranceEnabled?: boolean;
};

export function nativeAssurancePolicy(): NativeAssurancePolicy {
  // The assurance default resolves against the live merchant
  // shipping-insurance toggle when the payment-settings query has
  // resolved (PDP/checkout prefetch warms this cache). Before it
  // loads the setting stays undefined and the shared policy fails
  // the line to opt-out, so a paid fee never defaults on without
  // affirmative knowledge that the merchant enabled it.
  const cachedSettings = queryClient.getQueryData<PaymentSettings>(
    merchantPaymentSettingsQueryKey
  );
  return {
    smartCartProEnabled: CONFIG.ENABLE_SMART_CART_PRO,
    merchantSlug: CONFIG.MERCHANT_SLUG,
    shippingInsuranceEnabled: cachedSettings?.shipping_insurance_enabled,
  };
}
