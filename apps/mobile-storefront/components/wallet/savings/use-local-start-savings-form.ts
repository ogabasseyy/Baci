import { useState } from 'react';
import { useProduct } from '@/hooks/use-product';
import { useProductSearch } from '@/hooks/use-product-search';
import type { Product } from '@/types/product';
import type { LocalSavingsFormController } from './start-savings-controller.types';
import { toSelectedProductChoice } from './start-savings-controller.utils';
import type { useLocalSavingsDrafts } from './use-local-savings-drafts';

export function useLocalStartSavingsForm(
  model: ReturnType<typeof useLocalSavingsDrafts>,
  params: { productId?: string; variantId?: string }
) {
  const [productId, setProductId] = useState(params.productId ?? '');
  const [variantId, setVariantId] = useState<string | null>(
    params.variantId ?? null
  );
  const [searchValue, setSearchValue] = useState('');
  const debouncedSearch = searchValue;
  const catalogue = useProductSearch({
    search: debouncedSearch.trim() || undefined,
    enabled: !!debouncedSearch.trim(),
    limit: 20,
  });
  const selected = useProduct(productId);
  const product = selected.product?.id === productId ? selected.product : null;
  const choice = product
    ? toSelectedProductChoice({ product, variantId })
    : null;
  const missingVariants = !!product?.has_variants && !product.variants?.length;
  const canContinue =
    !!choice &&
    !choice.requiresVariantSelection &&
    !missingVariants &&
    !selected.isLoading &&
    !selected.error;
  const controller: LocalSavingsFormController = {
    searchValue,
    setSearchValue: (value) => {
      if (model.busy) return;
      setSearchValue(value);
      setProductId('');
      setVariantId(null);
    },
    debouncedSearch,
    products: catalogue.products,
    isProductsLoading: catalogue.isLoading,
    selectedProduct: choice,
    selectedCatalogProduct: product,
    selectProduct: (next: Product, nextVariantId?: string | null) => {
      if (model.busy) return;
      setProductId(next.id);
      setVariantId(nextVariantId ?? null);
      setSearchValue(next.name);
    },
    formError: missingVariants
      ? 'Exact device options are unavailable. Reload devices before continuing.'
      : null,
    isSubmitting: model.busy,
    canContinue,
    handleContinue: () => {
      if (canContinue && choice && !model.busy)
        void model.create(choice.id, choice.variantId ?? null);
    },
  };
  return {
    controller,
    isLoadingSelection: !!productId && selected.isLoading,
    catalogueError: catalogue.isError || !!selected.error,
    refresh: async () => {
      await Promise.all([
        catalogue.refetch(),
        selected.refetch(),
        model.reload(),
      ]);
    },
  };
}
