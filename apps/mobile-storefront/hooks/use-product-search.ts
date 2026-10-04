import { useQueryClient } from '@tanstack/react-query';
import {
  buildProductQueryKey,
  CONSTANT_MERCHANT_ID,
  resolveAndEvictProduct,
} from '@/hooks/product-utils';
import { useMerchant } from '@/hooks/use-merchant';
import { ProductRowSchema } from '@/lib/validation';
import type { Product } from '@/types/product';
import { augmentProduct } from './use-product';
import { useProducts } from './use-products';

/**
 * Catalogue search for savings device pickers (swap modal, start-savings
 * form). Thin adapter over the existing product primitives: list search
 * via useProducts, plus resolveProduct to hydrate a search-preview stub
 * into a full product through the same validated fetch as useProduct.
 */
export function useProductSearch({
  enabled,
  limit,
  search,
}: {
  enabled?: boolean;
  limit?: number;
  search?: string;
}) {
  const { products, isLoading, isError, refetch } = useProducts({
    enabled,
    limit,
    search,
  });
  const queryClient = useQueryClient();
  const { data: merchant } = useMerchant();
  const merchantId = merchant?.id || CONSTANT_MERCHANT_ID;

  // Plain function: React Compiler memoizes automatically; manual
  // useCallback is prohibited by repo convention (AGENTS.md).
  const resolveProduct = async (product: Product): Promise<Product> => {
    if (!product.slug) {
      throw new Error('Product has no slug to resolve');
    }
    const slug = product.slug;
    return queryClient.fetchQuery({
      queryKey: buildProductQueryKey(slug, merchantId),
      queryFn: async () => {
        const row = await resolveAndEvictProduct(merchantId, slug, queryClient);
        const validated = ProductRowSchema.safeParse(row);
        if (!validated.success) {
          throw new Error(
            `Product validation failed: ${validated.error.message}`
          );
        }
        return augmentProduct(validated.data);
      },
      staleTime: 1000 * 60 * 5,
    });
  };

  return { products, isLoading, isError, refetch, resolveProduct };
}
