import { useEffect, useRef } from 'react';
import { useCartStore } from '@/stores/cart-store';
import {
  MERCHANT_PAYMENT_SETTINGS_STALE_MS,
  useMerchantPaymentSettings,
} from './useMerchantPaymentSettings';

/**
 * Warms the merchant payment-settings cache at storefront launch and
 * reconciles cart lines that defaulted off while the shipping-insurance
 * setting was still unknown. Without the warm-up, a fresh-launch
 * quick-add resolves unknown and opts the line out; without the
 * reconciliation, that unknown-at-add state would permanently stick
 * even after the settings load with an affirmative true. The add-time
 * default itself stays fail-closed (opt-out when unknown); this only
 * revisits lines explicitly stamped as pending, and an explicit shopper
 * toggle always wins. Reconciliation waits for a network-fresh value —
 * never a restored (possibly stale) one — so reconcile runs at most
 * once per fresh load and never flips pending lines off a stale
 * disabled value.
 */
export function useWarmMerchantPaymentSettings(): void {
  const { data, dataUpdatedAt } = useMerchantPaymentSettings();
  const reconcilePendingAssuranceLines = useCartStore(
    (state) => state.reconcilePendingAssuranceLines
  );
  const reconciledAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (data === undefined) {
      return;
    }
    // Freshness-gated: only a fetch completed after this hook mounted
    // counts. dataUpdatedAt from before the mount is a restored persist
    // value whose refetch may still be in flight (staleTime expiry does
    // not guarantee the background fetch has landed yet).
    if (reconciledAtRef.current !== null) {
      return;
    }
    if (Date.now() - dataUpdatedAt > MERCHANT_PAYMENT_SETTINGS_STALE_MS) {
      return;
    }
    reconciledAtRef.current = dataUpdatedAt;
    reconcilePendingAssuranceLines(data.shipping_insurance_enabled);
  }, [data, dataUpdatedAt, reconcilePendingAssuranceLines]);
}
