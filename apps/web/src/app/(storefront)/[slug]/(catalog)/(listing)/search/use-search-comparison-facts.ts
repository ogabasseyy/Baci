'use client';
import { useEffect, useState } from 'react';
import {
  type NormalizedProduct,
  normalizeProduct,
  type RawDbProduct,
} from '@/lib/normalize-product';
import { STOREFRONT_PRODUCTS_SELECT } from '@/lib/storefront-products-select';
import { createClient } from '@/lib/supabase/client';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The web tray holds at most four selections; the refresh never needs more.
const MAX_COMPARISON_FACTS_IDS = 4;

/**
 * Opening comparison refreshes all selected identities, including other
 * result pages. Parent rows only: unlike the native tray, this refresh
 * does not verify matched variant/offer identity against the price
 * projection. The tray therefore shows parent-basis facts with a
 * "verify on product page" marker for matched entries; the PDP's
 * ID-gated selection is the source of truth on open.
 */
export function useSearchComparisonFacts(
  merchantId: string,
  ids: string[],
  open: boolean
) {
  const key = ids.join(',');
  const [state, setState] = useState<{
    key: string;
    products: NormalizedProduct[];
    pending: boolean;
    error: boolean;
  }>({ key: '', products: [], pending: false, error: false });
  useEffect(() => {
    if (!open || !key) return;
    let active = true;
    const controller = new AbortController();
    setState({ key, products: [], pending: true, error: false });
    // Session-persisted ids are untrusted input: drop malformed values so
    // one poisoned entry cannot fail the whole tray refresh, cap the
    // survivors to the tray capacity so a stuffed entry cannot build a
    // huge `in` query, and skip the round-trip when nothing valid remains
    // (PostgREST rejects empty `in`).
    const validIds = [
      ...new Set(key.split(',').filter((id) => UUID_PATTERN.test(id))),
    ].slice(0, MAX_COMPARISON_FACTS_IDS);
    async function refresh() {
      if (validIds.length === 0) {
        if (active)
          setState({ key, products: [], pending: false, error: false });
        return;
      }
      try {
        const { data, error } = await createClient()
          .from('products')
          .select(STOREFRONT_PRODUCTS_SELECT)
          .eq('merchant_id', merchantId)
          .eq('status', 'active')
          .in('id', validIds)
          .abortSignal(controller.signal);
        if (error) throw new Error('Comparison unavailable');
        if (active)
          setState({
            key,
            products: (data ?? []).map((row) =>
              normalizeProduct(row as unknown as RawDbProduct)
            ),
            pending: false,
            error: false,
          });
      } catch {
        if (active)
          setState({ key, products: [], pending: false, error: true });
      }
    }
    void refresh();
    return () => {
      active = false;
      controller.abort();
    };
  }, [key, merchantId, open]);
  return state.key === key
    ? state
    : { key, products: [], pending: open, error: false };
}
