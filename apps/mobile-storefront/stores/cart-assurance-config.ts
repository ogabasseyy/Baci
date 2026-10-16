import type { PaymentSettings } from '@/hooks/useMerchantPaymentSettings';
import {
  MERCHANT_PAYMENT_SETTINGS_STALE_MS,
  merchantPaymentSettingsQueryKey,
} from '@/hooks/useMerchantPaymentSettings';
import { CONFIG } from '@/lib/config';

type NativeAssurancePolicy = {
  smartCartProEnabled: boolean;
  merchantSlug: string | null | undefined;
  shippingInsuranceEnabled?: boolean;
};

// Boundary between restored and network-fresh query data. The persister
// rehydrates dataUpdatedAt from a previous session, so any timestamp
// predating this module's load (cart-store loads at app start) came from
// AsyncStorage, not the network — even when it falls inside the 5-minute
// freshness window. Treating it as authoritative would default new lines
// into paid assurance from a toggle the merchant may since have disabled.
const MODULE_LOAD_MS = Date.now();

export function isRestoredPaymentSettingsData(dataUpdatedAt: number): boolean {
  return dataUpdatedAt < MODULE_LOAD_MS;
}

function readCachedPaymentSettings(): PaymentSettings | undefined {
  try {
    // Lazy + guarded: lib/query-client instantiates QueryClient at module
    // scope, and suites that stub @tanstack/react-query (utilities screens)
    // would crash on a static import. An unreadable cache fails the setting
    // to unknown, and the shared policy fails unknown to opt-out.
    const { queryClient } =
      require('@/lib/query-client') as typeof import('@/lib/query-client');
    const state = queryClient.getQueryState<PaymentSettings>(
      merchantPaymentSettingsQueryKey
    );
    if (!state?.data) {
      return undefined;
    }
    // Freshness-gated: the persister restores up to 24h-old successes, so
    // a merchant toggle change would otherwise default new lines from a
    // stale restore — and those lines would NOT be stamped pending, so no
    // later reconciliation would correct them. Older than the query's own
    // stale window reads as unknown (pending-stamped, reconciled fresh).
    const updatedAt =
      typeof state.dataUpdatedAt === 'number' ? state.dataUpdatedAt : 0;
    if (Date.now() - updatedAt > MERCHANT_PAYMENT_SETTINGS_STALE_MS) {
      return undefined;
    }
    // Restore-gated: a FRESH restore (restart within the stale window)
    // passes the check above, but React Query also considers it fresh and
    // mounts will not refetch — so the value could outlive a merchant
    // toggle change. Read it as unknown (pending-stamped) and kick a
    // deduped refetch so the pending line reconciles in seconds instead
    // of waiting out the stale window.
    if (isRestoredPaymentSettingsData(updatedAt)) {
      void queryClient
        .refetchQueries({ queryKey: merchantPaymentSettingsQueryKey })
        .catch(() => undefined);
      return undefined;
    }
    return state.data;
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
