import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { hydrateSearchProductAvailability } from './search-product-availability';
import { selectStructuredDiscoveryOffer } from './select-structured-discovery-offer';

it.each(['new', null])('inherits parent condition %s instead of a legacy variant attribute', async (condition) => {
  const product = { id: 'phone', condition, price: 500,
    manage_stock: true, has_variants: true, stock_quantity: 0 };
  const supabase = { rpc: vi.fn().mockResolvedValue({ data: [{
    id: 'variant', product_id: 'phone', condition: null,
    attributes: { condition: 'used' }, price_override: 400, stock_quantity: 1,
  }], error: null }) } as unknown as SupabaseClient;

  const [used] = await hydrateSearchProductAvailability([product], supabase, 'merchant', 'used');
  expect(used.availableVariants).toEqual([]);
  const [asNew] = await hydrateSearchProductAvailability([product], supabase, 'merchant', 'new');
  expect(asNew.availableVariants).toHaveLength(1);
  const [unfiltered] = await hydrateSearchProductAvailability([product], supabase, 'merchant');
  expect(unfiltered.displayCondition).toBe('new');
  expect(selectStructuredDiscoveryOffer(unfiltered, { alternatives: [{}] }))
    .toMatchObject({ selectedOption: { condition: 'new', price: 400 } });
});
