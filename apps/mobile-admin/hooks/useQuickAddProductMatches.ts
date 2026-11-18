import { MOBILE_ADMIN_PRODUCT_COLUMNS_PUBLIC } from '@baci/shared';
import { useQueries, useQuery } from '@tanstack/react-query';
import type { CustomItemDraft } from '@/components/orders/new-order.types';
import { useDebounce } from '@/hooks/useDebounce';
import { useMerchant } from '@/hooks/useMerchant';
import { fetchAdminProductVariants } from '@/hooks/useProductPickerVariants';
import type { SelectableManualOrderProduct } from '@/lib/manual-order-line-item';
import type { ProductPickerVariantParent } from '@/lib/product-picker-variant-rows';
import { fetchAdminProductSearchRows } from '@/lib/product-search';
import { findQuickAddProductMatches } from '@/lib/quick-add-product-matches';

const QUICK_ADD_PRODUCT_COLUMNS = `${MOBILE_ADMIN_PRODUCT_COLUMNS_PUBLIC}, parent_product_id`;

export function useQuickAddProductMatches(customItem: CustomItemDraft) {
  const { merchant } = useMerchant();
  const merchantId = merchant?.id;
  const debouncedName = useDebounce(customItem.name, 300);
  const queryText = debouncedName.trim();
  const isEnabled = Boolean(merchantId && queryText.length >= 2);

  const { data: productRows, isLoading: isProductsLoading } = useQuery({
    enabled: isEnabled,
    queryKey: ['quick-add-product-candidates', merchantId, queryText],
    queryFn: async () => {
      if (!merchantId) {
        return [];
      }

      const page =
        await fetchAdminProductSearchRows<SelectableManualOrderProduct>({
          cursor: 0,
          filters: { search: queryText },
          merchantId,
          pageSize: 10,
          selectColumns: QUICK_ADD_PRODUCT_COLUMNS,
        });

      return page.rows;
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  const products = productRows ?? [];
  const variantParents = products.filter((product) => product.has_variants);
  const variantQueries = useQueries({
    queries: variantParents.slice(0, 5).map((parentProduct) => ({
      enabled: Boolean(merchantId && parentProduct.id && queryText.length >= 2),
      queryKey: ['quick-add-product-variants', merchantId, parentProduct.id],
      queryFn: () =>
        fetchAdminProductVariants({
          merchantId: merchantId ?? '',
          parentProduct: parentProduct as ProductPickerVariantParent & {
            id: string;
          },
        }),
      staleTime: 1000 * 60 * 5, // 5 minutes
    })),
  });

  const variants = variantQueries.flatMap((query) => query.data ?? []);

  return {
    isLoading:
      isProductsLoading ||
      variantQueries.some((query) => query.isLoading || query.isFetching),
    matches: findQuickAddProductMatches({
      customItem,
      products: [...products, ...variants],
    }),
  };
}
