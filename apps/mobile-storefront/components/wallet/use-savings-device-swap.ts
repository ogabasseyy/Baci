import { useRef, useState } from 'react';
import { useProductSearch } from '@/hooks/use-product-search';
import { useAuthStore } from '@/stores/auth-store';
import type { Product } from '@/types/product';
import { savingsNotifier } from './savings/savings-notice';

/** State for the "change savings device" sheet: search, results, and the swap. */
export function useSavingsDeviceSwap(
  onChangeSavingsDevice: (
    product: Product,
    variantId?: string | null
  ) => Promise<boolean>,
  /** The goal being changed; a reply for another goal never closes this one. */
  goalId?: string
) {
  const userId = useAuthStore((state) => state.user?.id);
  const merchantId = useAuthStore((state) => state.merchantId ?? undefined);
  const scope = useRef('');
  // Blocks a second "Switch phone" tap before React re-renders as busy:
  // the swap is not idempotent.
  const inFlight = useRef(false);
  scope.current = `${userId}:${merchantId}:${goalId}`;
  const [showSavingsDeviceSwap, setShowSavingsDeviceSwap] = useState(false);
  const [savingsDeviceSearch, setSavingsDeviceSearch] = useState('');
  const [isChangingSavingsDevice, setIsChangingSavingsDevice] = useState(false);
  const trimmedSavingsDeviceSearch = savingsDeviceSearch.trim();
  const {
    products: savingsDeviceProducts,
    isLoading: isSavingsDeviceLoading,
    resolveProduct,
  } = useProductSearch({
    enabled: showSavingsDeviceSwap,
    limit: 8,
    search: trimmedSavingsDeviceSearch || undefined,
  });
  const handleSelectSavingsDevice = async (
    product: Product,
    variantId?: string | null
  ) => {
    if (inFlight.current) return;
    inFlight.current = true;
    const notify = savingsNotifier();
    const started = scope.current;
    setIsChangingSavingsDevice(true);
    try {
      const didChange = await onChangeSavingsDevice(product, variantId);
      // The account, store or goal changed meanwhile: leave the new picker be.
      if (didChange && scope.current === started) {
        setShowSavingsDeviceSwap(false);
        setSavingsDeviceSearch('');
      }
    } catch {
      notify(
        'Unable to change device',
        'Please try again in a moment.',
        'warning'
      );
    }
    inFlight.current = false;
    setIsChangingSavingsDevice(false);
  };
  return {
    handleSelectSavingsDevice,
    isChangingSavingsDevice,
    isSavingsDeviceLoading,
    resolveProduct,
    savingsDeviceProducts,
    savingsDeviceSearch,
    setSavingsDeviceSearch,
    setShowSavingsDeviceSwap,
    showSavingsDeviceSwap,
  };
}
