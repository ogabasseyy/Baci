import { useQuery } from '@tanstack/react-query';
import type { Product } from '@/types/product';
import { resolveProductRow, transformProduct } from './product-utils';
import { useMerchant } from './use-merchant';
/** Refresh saved identities; missing products never masquerade as current facts. */
export function useComparisonProducts(selected: Product[]) {
  const { data: merchant } = useMerchant();
  const query = useQuery({
    queryKey: ['comparison-facts', merchant?.id, selected.map((p) => p.id)],
    enabled: Boolean(merchant?.id && selected.length),
    staleTime: 0,
    queryFn: () => {
      if (!merchant?.id) throw new Error('Merchant unavailable');
      return Promise.all(
        selected.map(async (snapshot) => {
          const row = await resolveProductRow(merchant.id, snapshot.id);
          const product = row ? transformProduct(row) : null;
          if (!product)
            return {
              product: {
                ...snapshot,
                price: 0,
                compare_at_price: undefined,
                rating: undefined,
                specifications: undefined,
                in_stock: false,
              },
              unavailable: true,
            };
          const match = snapshot.searchMatch;
          const option = match?.variantId
            ? product.variants?.find((v) => v.id === match.variantId)
            : match?.offerId
              ? product.offers?.find((o) => o.id === match.offerId)
              : undefined;
          // Exact matched options require a fresh matching option; never substitute a parent silently.
          const optionAvailable = option
            ? match?.variantId
              ? (!('in_stock' in option) || option.in_stock !== false) &&
                (row?.manage_stock === false ||
                  (option.stock_quantity ?? product.stock_quantity ?? 0) > 0)
              : row?.manage_stock === false || (option.stock_quantity ?? 0) > 0
            : false;
          if (match && (match.variantId || match.offerId) && !optionAvailable)
            return {
              product: {
                ...product,
                searchMatch: match,
                price: 0,
                compare_at_price: undefined,
                rating: undefined,
              },
              unavailable: true,
            };
          return {
            product: {
              ...product,
              searchMatch: match,
              price: option?.price ?? product.price,
              condition: option?.condition ?? product.condition,
              specifications: {
                ...product.specifications,
                ...(option && 'attributes' in option ? option.attributes : {}),
              },
            },
            unavailable: false,
          };
        })
      );
    },
  });
  const products =
    query.data?.map((item) => item.product) ??
    selected.map((snapshot) => ({
      ...snapshot,
      price: 0,
      compare_at_price: undefined,
      rating: undefined,
      specifications: undefined,
    }));
  return {
    products,
    // Until the refresh resolves, every fallback id is unverified: the
    // loading products carry price 0, and without their ids here the table
    // would present 0 as a current price. The status line already says
    // prices are refreshing, so this never flashes a false failure.
    unavailableIds:
      query.data
        ?.filter((item) => item.unavailable)
        .map((item) => item.product.id) ?? products.map((p) => p.id),
    status: query.isFetching
      ? 'Refreshing prices and specifications…'
      : query.error
        ? 'Couldn’t refresh. Open a product to check its current details.'
        : query.data?.some((item) => item.unavailable)
          ? 'Some products or options are unavailable. Open details to choose another option.'
          : query.data
            ? 'Current prices. Matched options retain their condition and specification basis.'
            : 'Saved comparison. Open a product to check current details.',
  };
}
