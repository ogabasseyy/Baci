import type { PaymentSettings } from '@/hooks/useMerchantPaymentSettings';
import { merchantPaymentSettingsQueryKey } from '@/hooks/useMerchantPaymentSettings';
import { CONFIG } from '@/lib/config';

type NativeAssurancePolicy = {
  smartCartProEnabled: boolean;
  merchantSlug: string | null | undefined;
  shippingInsuranceEnabled?: boolean;
};

function readCachedPaymentSettings(): PaymentSettings | undefined {
  try {
    // Lazy + guarded: lib/query-client instantiates QueryClient at module
    // scope, and suites that stub @tanstack/react-query (utilities screens)
    // would crash on a static import. An unreadable cache fails the setting
    // to unknown, and the shared policy fails unknown to opt-out.
    const { queryClient } =
      require('@/lib/query-client') as typeof import('@/lib/query-client');
    return queryClient.getQueryData<PaymentSettings>(
      merchantPaymentSettingsQueryKey
    );
  } catch {
    return undefined;
  }
}

export function nativeAssurancePolicy(): NativeAssurancePolicy {
  // The assurance default resolves against the live merchant
  // shipping-insurance toggle when the payment-settings query has
  // resolved (PDP/checkout prefetch warms this cache). Before it
  // loads the setting stays undefined and the shared policy fails
  // the line to opt-out, so a paid fee never defaults on without
  // affirmative knowledge that the merchant enabled it.
  const cachedSettings = readCachedPaymentSettings();
  return {
    smartCartProEnabled: CONFIG.ENABLE_SMART_CART_PRO,
    merchantSlug: CONFIG.MERCHANT_SLUG,
    shippingInsuranceEnabled: cachedSettings?.shipping_insurance_enabled,
  };
}
