import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { hydrateSearchProductAvailability } from './search-product-availability';

describe('hydrateSearchProductAvailability snapshot windows', () => {
  it('windows offers and variants to the storefront snapshot with disclosure', async () => {
    const offers = Array.from({ length: 17 }, (_, i) => ({
      product_id: 'wide', condition: i === 0 ? 'used' : 'open_box', price: 400 + i, stock_quantity: 1,
    }));
    const variants = Array.from({ length: 129 }, (_, i) => ({
      id: `v-${i}`, product_id: 'wide', attributes: { color: 'black' },
      price_override: 500 - i, stock_quantity: 1,
    }));
    const offerQuery = {
      select: vi.fn(), eq: vi.fn(), in: vi.fn(), order: vi.fn(),
      then: (resolve: (value: { data: typeof offers; error: null }) => unknown) =>
        Promise.resolve({ data: offers, error: null }).then(resolve),
    };
    offerQuery.select.mockReturnValue(offerQuery);
    offerQuery.eq.mockReturnValue(offerQuery);
    offerQuery.in.mockReturnValue(offerQuery);
    offerQuery.order.mockReturnValue(offerQuery);
    const [row] = await hydrateSearchProductAvailability([{
      id: 'wide', condition: 'new', price: 500, manage_stock: false,
      has_variants: true, has_condition_offers: true, stock_quantity: 0,
    }], {
      rpc: vi.fn(async (name: string) => name === 'get_mcp_search_product_variants'
        ? { data: variants, error: null }
        : await offerQuery),
    } as unknown as SupabaseClient, 'merchant-1');

    expect(row.availableOffers).toHaveLength(16);
    expect(row.availableOffers.map((offer) => offer.price)).not.toContain(416);
    expect(row.allVariants).toHaveLength(128);
    // Price-ordered window keeps the cheapest 128: v-128 at 372 survives,
    // v-0 at 500 is cut, and the truncation is disclosed.
    expect(row.allVariants.map((variant) => variant.id)).toContain('v-128');
    expect(row.allVariants.map((variant) => variant.id)).not.toContain('v-0');
    expect(row.variantWindowTruncated).toBe(true);
  });
});
