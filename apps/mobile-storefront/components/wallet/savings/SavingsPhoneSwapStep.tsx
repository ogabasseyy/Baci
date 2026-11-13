import { useEffect, useRef, useState } from 'react';
import type Colors from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import { useAuthStore } from '@/stores/auth-store';
import type { Product } from '@/types/product';
import { useSavingsSheetLock } from '../SavingsSheetLock';
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
  // The swap is saved once: the sheet stays open until it settles.
  useSavingsSheetLock(isPending);
  // A pick or loaded preview only counts for the account, store and goal it
  // was made for: switching any of them never carries it over.
  const userId = useAuthStore((state) => state.user?.id ?? '');
  const merchantId = useAuthStore((state) => state.merchantId ?? '');
  const scope = `${userId}:${merchantId}:${goal.id}`;
  const [picked, setPicked] = useState<{
    row: SavingsPhoneRow;
    scope: string;
  } | null>(null);
  const chosen = picked && picked.scope === scope ? picked.row : null;
  const setChosen = (row: SavingsPhoneRow | null) =>
    setPicked(row ? { row, scope } : null);
  const [loaded, setLoaded] = useState<{
    query: string;
    product: Product;
    scope: string;
  } | null>(null);
  const resolved = loaded && loaded.scope === scope ? loaded : null;
  const setResolved = (value: { query: string; product: Product } | null) =>
    setLoaded(value ? { ...value, scope } : null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const request = useRef(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new search, account, store or goal invalidates a preview being loaded.
  useEffect(() => {
    setLoadingPreview(false);
    setLoadError(null);
    // A preview opened for an earlier search never stands in for new results.
    setResolved(null);
    return () => {
      request.current++;
    };
  }, [searchValue, scope]);

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

  // A loaded preview has real options and prices now, so the price filter
  // applies to it like any other phone.
  const shown =
    resolved?.query === searchValue
      ? [{ ...resolved.product, searchPreview: false }]
      : products;
  const rows = shown.flatMap(savingsPhoneRows);
  // The phone saved for now is not a choice to switch to.
  const isCurrent = (row: SavingsPhoneRow) =>
    goal.product_id
      ? row.product.id === goal.product_id &&
        (row.variantId ?? null) === (goal.variant_id ?? null)
      : // Older goals without ids: same name and price is the best match.
        row.title === goal.title && row.price === goal.target_amount;
  const choices = rows.filter((row) => !isCurrent(row));
  const affordable = choices.filter(
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
      if (version !== request.current) return;
      setResolved({ query: searchValue, product: current });
      // Its real price can be below what's saved: say so rather than letting
      // the phone silently drop out of the list.
      const options = savingsPhoneRows({ ...current, searchPreview: false });
      if (
        options.length > 0 &&
        options.every((option) => option.price < goal.current_amount)
      )
        setLoadError(
          `${current.name} costs less than the ${formatNgnCurrency(goal.current_amount)} you've saved, so you can't switch to it.`
        );
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
      hiddenCount={choices.length - affordable.length}
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
