import { useEffect, useState } from 'react';
import type { Product } from '@/types/product';
import type { SavingsProductChoice } from './start-savings.types';
import {
  buildSavingsVariantOptionGroups,
  completeSavingsSingleValueSelection,
  resolveSavingsVariant,
  type SavingsVariantSelection,
  seedSavingsVariantSelection,
  selectSavingsVariantOption,
} from './start-savings-variant-options';

/**
 * Option-group variant orchestration for the start-savings form.
 *
 * Owns the selected product source plus the per-axis selection: seeding
 * from the route variant, single-value auto-completion, option picking
 * (which re-resolves through product selection), and the search-divergence
 * reset. Product/variant identity stays in
 * `useStartSavingsProductSelection`; this hook only drives the
 * axis-selection UI state on top of it.
 */
export function useStartSavingsVariantSelection({
  clearProductSelection,
  routeVariantId,
  searchValue,
  selectedCatalogProduct,
  selectedProduct,
  selectProduct,
}: {
  clearProductSelection: () => void;
  routeVariantId: string | null | undefined;
  searchValue: string;
  selectedCatalogProduct: Product | null;
  selectedProduct: SavingsProductChoice | null;
  selectProduct: (product: Product, variantId?: string | null) => void;
}) {
  const [selectedProductSource, setSelectedProductSource] =
    useState<Product | null>(null);
  const [variantSelection, setVariantSelection] =
    useState<SavingsVariantSelection>({});

  const selectVariantOption = (axis: string, value: string) => {
    const variants = selectedProductSource?.variants ?? [];
    if (!selectedProductSource || variants.length === 0) {
      return;
    }
    const selection = selectSavingsVariantOption(
      variants,
      variantSelection,
      axis,
      value
    );
    const resolvedVariant = resolveSavingsVariant(variants, selection);
    setVariantSelection(selection);
    selectProduct(selectedProductSource, resolvedVariant?.id ?? null);
  };

  useEffect(() => {
    if (!selectedCatalogProduct) {
      return;
    }
    const variants = selectedCatalogProduct.variants ?? [];
    setSelectedProductSource(selectedCatalogProduct);
    setVariantSelection(
      completeSavingsSingleValueSelection(
        variants,
        seedSavingsVariantSelection(variants, routeVariantId)
      )
    );
  }, [routeVariantId, selectedCatalogProduct]);

  useEffect(() => {
    if (!selectedProduct || searchValue === selectedProduct.name) {
      return;
    }
    clearProductSelection();
    setSelectedProductSource(null);
    setVariantSelection({});
  }, [clearProductSelection, searchValue, selectedProduct]);

  return {
    selectVariantOption,
    variantOptionGroups: buildSavingsVariantOptionGroups(
      selectedProductSource?.variants ?? [],
      variantSelection
    ),
  };
}
