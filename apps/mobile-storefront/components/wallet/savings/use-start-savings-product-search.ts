import { useDebounce } from '@/hooks/use-debounce';
import { useProductSearch } from '@/hooks/use-product-search';
import type { SavingsSearchParams } from './start-savings.types';
import { readParam } from './start-savings-controller.utils';

export function useStartSavingsProductSearch({
  params,
  searchValue,
}: {
  params: SavingsSearchParams;
  searchValue: string;
}) {
  // Debounced like storefront search: useProducts starts an uncancelled
  // Supabase query per search string, so raw keystrokes would fan out.
  const debouncedSearch = useDebounce(searchValue, 300);
  const {
    products,
    isLoading: isProductsLoading,
    resolveProduct,
  } = useProductSearch({
    enabled: Boolean(debouncedSearch.trim() || readParam(params.productId)),
    limit: 8,
    search: debouncedSearch.trim() ? debouncedSearch.trim() : undefined,
  });
  return { debouncedSearch, isProductsLoading, products, resolveProduct };
}
