import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { addCheckoutSessionTax } from './checkout-session-tax';

const lineItems = [
  {
    id: 'line-1',
    item: {
      id: 'product-1',
      product_id: 'product-1',
      quantity: 3,
      title: 'Phone',
    },
    base_amount: 3.15,
    discount: 0,
    subtotal: 3.15,
    tax: 0,
    total: 3.15,
  },
];

function createSupabase(
  merchant: { vat_registration_status: string } | null,
  error: unknown = null
) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: merchant, error });
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  return { client: { from } as unknown as SupabaseClient, from, maybeSingle };
}

describe('addCheckoutSessionTax', () => {
  it('adds registered VAT to the quote total and leaves shipping untaxed', async () => {
    const { client, from, maybeSingle } = createSupabase({
      vat_registration_status: 'registered',
    });
    const result = await addCheckoutSessionTax({
      fulfillmentTotals: [
        { type: 'items_base_amount', display_text: 'Items', amount: 3.15 },
        { type: 'fulfillment', display_text: 'Shipping', amount: 2500 },
        { type: 'total', display_text: 'Total', amount: 2503.15 },
      ],
      lineItems,
      products: [
        {
          id: 'product-1',
          name: 'Phone',
          price: 1.05,
          stock: 0,
          vat_category_code: 'S',
          vat_rate: 7.5,
        },
      ],
      supabase: client,
      variants: [],
      merchantId: 'merchant-1',
    });

    expect(from).toHaveBeenCalledWith('merchants');
    expect(maybeSingle).toHaveBeenCalledOnce();
    expect(result.lineItems[0]?.tax).toBe(0.24);
    expect(result.totals).toEqual([
      { type: 'items_base_amount', display_text: 'Items', amount: 3.15 },
      { type: 'fulfillment', display_text: 'Shipping', amount: 2500 },
      { type: 'tax', display_text: 'Tax', amount: 0.24 },
      { type: 'total', display_text: 'Total', amount: 2503.39 },
    ]);
  });

  it('fails closed when merchant VAT status cannot be loaded', async () => {
    const { client } = createSupabase(null, { code: 'XX000' });
    await expect(
      addCheckoutSessionTax({
        fulfillmentTotals: [],
        lineItems,
        products: [],
        supabase: client,
        variants: [],
        merchantId: 'merchant-1',
      })
    ).rejects.toThrow('Failed to load checkout VAT status');
  });
});
