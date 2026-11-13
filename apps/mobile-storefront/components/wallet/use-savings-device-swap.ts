import { useState } from 'react';
import { useProductSearch } from '@/hooks/use-product-search';
import type { Product } from '@/types/product';
import { savingsNotifier } from './savings/savings-notice';

/** State for the "change savings device" sheet: search, results, and the swap. */
export function useSavingsDeviceSwap(
  onChangeSavingsDevice: (
    product: Product,
    variantId?: string | null
  ) => Promise<boolean>
) {
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
    const notify = savingsNotifier();
    setIsChangingSavingsDevice(true);
    try {
      const didChange = await onChangeSavingsDevice(product, variantId);
      if (didChange) {
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
