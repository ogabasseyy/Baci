import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { loadMcpProductVariants } from './product-variants';
import { createSupabase } from './product-variants-test-fixtures';

describe('loadMcpProductVariants partial lookup failures', () => {
  it('shows stocked offers when a combined product variant lookup fails', async () => {
    const supabase = createSupabase();
    supabase.query.single.mockResolvedValue({
      data: {
        id: 'phone-1',
        name: 'Phone',
        manage_stock: true,
        has_variants: true,
        has_condition_offers: true,
      },
      error: null,
    });
    supabase.rpc.mockImplementation(async (name: string) =>
      name === 'get_storefront_product_variants'
        ? { data: null, error: { message: 'variants unavailable' } }
        : {
            data: [
              {
                product_id: 'phone-1',
                offer_id: 'offer-used',
                condition: 'used',
                grade: null,
                price_basis: 70000,
                allocatable_stock: 2,
                parent_eligible: true,
                condition_notes: null,
              },
            ],
            error: null,
          },
    );
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await loadMcpProductVariants({
        args: { product_id: 'phone-1' },
        merchantId: 'merchant-1',
        supabase: supabase as unknown as SupabaseClient,
        sanitizeString: (value) => value,
        formatPrice: String,
      });
      expect(supabase.rpc).toHaveBeenCalledWith('get_storefront_offer_resolution', {
        p_merchant_id: 'merchant-1',
        p_product_ids: ['phone-1'],
      });
      expect(result.content[0].text).toContain('• used: 70000 - In Stock');
      expect(result.structuredContent).toMatchObject({
        condition_offers: [{ availability: 'in_stock' }],
      });
    } finally {
      log.mockRestore();
    }
  });

  it('shows stocked variants when a combined product offer lookup fails', async () => {
    const supabase = createSupabase();
    supabase.query.single.mockResolvedValue({
      data: {
        id: 'phone-1',
        name: 'Phone',
        manage_stock: true,
        has_variants: true,
        has_condition_offers: true,
      },
      error: null,
    });
    supabase.rpc.mockImplementation(async (name: string) =>
      name === 'get_storefront_offer_resolution'
        ? { data: null, error: { message: 'offers unavailable' } }
        : {
            data: [
              {
                attributes: { color: 'Red' },
                price_override: null,
                stock_quantity: 2,
              },
            ],
            error: null,
          },
    );
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await loadMcpProductVariants({
        args: { product_id: 'phone-1' },
        merchantId: 'merchant-1',
        supabase: supabase as unknown as SupabaseClient,
        sanitizeString: (value) => value,
        formatPrice: String,
      });
      expect(result.content[0].text).toContain('**Colors:** Red');
      expect(result.content[0].text).toContain(
        'Condition offers are temporarily unavailable.',
      );
      expect(result.structuredContent).toMatchObject({
        variants: [{ availability: 'in_stock' }],
        offer_lookup_failed: true,
      });
    } finally {
      log.mockRestore();
    }
  });

});
