import { useEffect, useRef, useState } from 'react';
import type Colors from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import type { Product } from '@/types/product';
import type { useSavingsDeviceSwap } from '../use-savings-device-swap';
import { SavingsPhonePickList } from './SavingsPhonePickList';
import { SavingsPhoneSwapConfirm } from './SavingsPhoneSwapConfirm';
import { type SavingsPhoneRow, savingsPhoneRows } from './savings-phone-rows';

type WalletColors = (typeof Colors)['light'];

/**
 * Change phone inside the savings sheet: pick a phone, then confirm. Nothing
 * is sent until "Switch phone"; a search result that is only a preview is
 * loaded first so its exact options and prices are what the customer picks.
 */
export function SavingsPhoneSwapStep({
  colors,
  goal,
  swap,
}: {
  colors: WalletColors;
  goal: WalletActiveSavingsGoal;
  swap: Pick<
    ReturnType<typeof useSavingsDeviceSwap>,
    | 'handleSelectSavingsDevice'
    | 'isChangingSavingsDevice'
    | 'isSavingsDeviceLoading'
    | 'resolveProduct'
    | 'savingsDeviceProducts'
    | 'savingsDeviceSearch'
    | 'setSavingsDeviceSearch'
    | 'setShowSavingsDeviceSwap'
  >;
}) {
  const searchValue = swap.savingsDeviceSearch;
  const products = swap.savingsDeviceProducts;
  const resolveProduct = swap.resolveProduct;
  const isPending = swap.isChangingSavingsDevice;
  const [chosen, setChosen] = useState<SavingsPhoneRow | null>(null);
  const [resolved, setResolved] = useState<{
    query: string;
    product: Product;
  } | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const request = useRef(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new search invalidates a preview being loaded.
  useEffect(() => {
    setLoadingPreview(false);
    setLoadError(null);
    return () => {
      request.current++;
    };
  }, [searchValue]);

  if (chosen)
    return (
      <SavingsPhoneSwapConfirm
        colors={colors}
        goal={goal}
        pending={isPending}
        row={chosen}
        onKeep={() => setChosen(null)}
        onConfirm={() =>
          void swap.handleSelectSavingsDevice(chosen.product, chosen.variantId)
        }
      />
    );

  const shown = resolved?.query === searchValue ? [resolved.product] : products;
  const rows = shown.flatMap(savingsPhoneRows);
  const affordable = rows.filter(
    (row) => row.product.searchPreview || row.price >= goal.current_amount
  );

  const pick = async (row: SavingsPhoneRow) => {
    if (!row.product.searchPreview) {
      setChosen(row);
      return;
    }
    if (!resolveProduct) return;
    const version = ++request.current;
    setLoadingPreview(true);
    setLoadError(null);
    try {
      const current = await resolveProduct(row.product);
      if (version === request.current)
        setResolved({ query: searchValue, product: current });
    } catch {
      if (version === request.current)
        setLoadError("Couldn't load this phone's options. Please try again.");
    } finally {
      if (version === request.current) setLoadingPreview(false);
    }
  };

  return (
    <SavingsPhonePickList
      colors={colors}
      goal={goal}
      hiddenCount={rows.length - affordable.length}
      loading={swap.isSavingsDeviceLoading || loadingPreview}
      loadError={loadError}
      onBack={() => swap.setShowSavingsDeviceSwap(false)}
      onPick={(row) => void pick(row)}
      onSearchChange={swap.setSavingsDeviceSearch}
      rows={affordable}
      searchValue={searchValue}
    />
  );
}
