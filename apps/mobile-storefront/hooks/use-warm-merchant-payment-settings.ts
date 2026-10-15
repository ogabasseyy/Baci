import { useEffect } from 'react';
import { useCartStore } from '@/stores/cart-store';
import { useMerchantPaymentSettings } from './useMerchantPaymentSettings';

/**
 * Warms the merchant payment-settings cache at storefront launch and
 * reconciles cart lines that defaulted off while the shipping-insurance
 * setting was still unknown. Without the warm-up, a fresh-launch
 * quick-add resolves unknown and opts the line out; without the
 * reconciliation, that unknown-at-add state would permanently stick
 * even after the settings load with an affirmative true. The add-time
 * default itself stays fail-closed (opt-out when unknown); this only
 * revisits lines explicitly stamped as pending, and an explicit shopper
 * toggle always wins.
 */
export function useWarmMerchantPaymentSettings(): void {
  const { data } = useMerchantPaymentSettings();
  const reconcilePendingAssuranceLines = useCartStore(
    (state) => state.reconcilePendingAssuranceLines
  );

  useEffect(() => {
    if (data === undefined) {
      return;
    }
    reconcilePendingAssuranceLines(data.shipping_insurance_enabled);
  }, [data, reconcilePendingAssuranceLines]);
}
