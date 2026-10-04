import { useQuery } from '@tanstack/react-query';
import { withSupabaseRetry } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import type { Product } from '@/types/product';
import { resolveProductRow, transformProduct } from './product-utils';
import { useMerchant } from './use-merchant';
/** Refresh saved identities; missing products never masquerade as current facts. */
export function useComparisonProducts(selected: Product[]) {
  const { data: merchant } = useMerchant();
  const query = useQuery({
    queryKey: [
      'comparison-facts',
      merchant?.id,
      selected.map((p) => [
        p.id,
        p.searchMatch?.variantId ?? null,
        p.searchMatch?.offerId ?? null,
        p.searchMatch?.condition ?? null,
      ]),
    ],
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
          // Purchasability comes from the same serialized-aware projection
          // search uses: the hydrated row maps serialized options to
          // available=0, so raw stock math here would mark purchasable
          // serialized options unavailable on refresh.
          let optionAvailable = false;
          if (match && (!(match.variantId || match.offerId) || option)) {
            const { data, error } = await withSupabaseRetry(async () =>
              supabase.rpc('get_storefront_search_price_options', {
                p_merchant_id: merchant.id,
                p_product_id: product.id,
              })
            );
            if (error) throw error;
            const options = (data ?? []) as {
              variant_id: string | null;
              offer_id: string | null;
            }[];
            optionAvailable = match.variantId
              ? options.some((o) => o.variant_id === match.variantId)
              : match.offerId
                ? options.some((o) => o.offer_id === match.offerId)
                : options.some(
                    (o) => o.variant_id === null && o.offer_id === null
                  );
          }
          if (match && !optionAvailable)
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
              // A matched option price must never pair with the parent's
              // strike-through: suppress it exactly as the search card does
              // for matched items, so the table shows no false discount.
              compare_at_price: match ? undefined : product.compare_at_price,
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
      // A settled refresh failure invalidates every cached fact: without
      // their ids here the table would present stale prices as current.
      query.isError
        ? products.map((p) => p.id)
        : (query.data
            ?.filter((item) => item.unavailable)
            .map((item) => item.product.id) ?? products.map((p) => p.id)),
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
