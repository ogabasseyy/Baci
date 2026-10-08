import { useQuery } from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';
import { useEffect, useRef } from 'react';
import { withSupabaseRetry } from '@/lib/api';
import { normalizeProductConditionFilterValue } from '@/lib/product-filter-options';
import { supabase } from '@/lib/supabase';
import type { Product } from '@/types/product';
import { resolveProductRow, transformProduct } from './product-utils';
import { useMerchant } from './use-merchant';
/**
 * Refresh saved identities; missing products never masquerade as current facts.
 *
 * Invariant: loading and refresh-failure fallbacks synthesize `price: 0`
 * products, so every consumer MUST honor `unavailableIds` and never render
 * a listed id's price as current — an ignored id displays a false zero.
 */
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
          // Consult the projection for every match — even exact ids missing
          // from the hydrated row, whose absence may be a degraded hydration
          // outage rather than a genuine removal. The projection needs no
          // local variant data; skipping it would turn a transient outage
          // into a false permanent-unavailable verdict.
          let optionAvailable = false;
          let liveCondition = normalizeProductConditionFilterValue(
            option?.condition ?? product.condition
          );
          let livePrice: number | undefined;
          if (match) {
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
              condition?: string;
              effective_price?: number | null;
            }[];
            const liveOption = options.find((o) =>
              match.variantId
                ? o.variant_id === match.variantId
                : match.offerId
                  ? o.offer_id === match.offerId
                  : o.variant_id === null && o.offer_id === null
            );
            optionAvailable = Boolean(liveOption);
            liveCondition =
              normalizeProductConditionFilterValue(liveOption?.condition) ??
              liveCondition;
            // Degraded hydration may verify the exact id while the local
            // option stays missing: price from the projection, never the
            // parent price, so a verified label never shows an unverified
            // amount.
            if (typeof liveOption?.effective_price === 'number') {
              livePrice = liveOption.effective_price;
            }
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
              searchMatch: match
                ? { ...match, condition: liveCondition }
                : undefined,
              price: option?.price ?? livePrice ?? product.price,
              // A matched option price must never pair with the parent's
              // strike-through: suppress it exactly as the search card does
              // for matched items, so the table shows no false discount.
              compare_at_price: match ? undefined : product.compare_at_price,
              // A matched base row has no option identity, but the table
              // reads product.condition: restore the refreshed live
              // condition, not the parent's "New & Used" aggregate label.
              condition:
                option?.condition ??
                (match && !(match.variantId || match.offerId)
                  ? liveCondition
                  : product.condition),
              // A degraded exact-variant match may verify identity, price,
              // and condition while the local option stays missing: the
              // parent specifications are then unverified for the matched
              // option (a 128 GB match must not show the parent's 256 GB),
              // so suppress them and let the cells render unknown.
              specifications:
                match?.variantId && !option
                  ? {}
                  : {
                      ...product.specifications,
                      ...(option && 'attributes' in option
                        ? option.attributes
                        : {}),
                    },
            },
            unavailable: false,
          };
        })
      );
    },
  });
  // The app-wide client disables focus refetching and the stack keeps the
  // comparison screen mounted, so returning from a pushed PDP would
  // otherwise leave the "current prices" status over stale facts. Refetch
  // only on false-to-true transitions: mount already fetches via
  // refetchOnMount, and refetching on every focus render would double-fetch.
  const isFocused = useIsFocused();
  const wasFocusedRef = useRef(isFocused);
  useEffect(() => {
    const wasFocused = wasFocusedRef.current;
    wasFocusedRef.current = isFocused;
    if (isFocused && !wasFocused) void query.refetch();
  }, [isFocused, query]);
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
