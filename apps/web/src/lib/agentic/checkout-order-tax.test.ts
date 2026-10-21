import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import {
  computeAgenticOrderTax,
  isTaxComputeUuidError,
  TaxComputeError,
} from '@/lib/agentic/checkout-order-tax';

type FromHandler = (table: string) => unknown;

function buildSupabaseMock(handlers: {
  merchant?: { vat_registration_status: string | null };
  products?: Array<{
    id: string;
    price: number | string | null;
    vat_category_code: string | null;
    vat_rate: number | string | null;
  }>;
  variants?: Array<{
    id: string;
    product_id: string;
    price_override: number | string | null;
  }>;
}): SupabaseClient {
  const from: FromHandler = (table: string) => {
    if (table === 'merchants') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: handlers.merchant ?? null,
                error: null,
              }),
          }),
        }),
      };
    }
    if (table === 'products') {
      // Mock matches the helper's chained `.eq('merchant_id', ...).in('id', ...)`
      // — `.eq` returns a builder that supports `.in` then `.returns`.
      return {
        select: () => ({
          eq: () => ({
            in: () => ({
              returns: () =>
                Promise.resolve({
                  data: handlers.products ?? [],
                  error: null,
                }),
            }),
          }),
        }),
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  };

  // B3.5 round 7 (CodeRabbit High): variant lookup now routes
  // through the `get_order_variant_overrides` SECURITY DEFINER
  // RPC so the Next.js layer never escalates to service-role.
  const rpc = (name: string) => {
    if (name === 'get_order_variant_overrides') {
      return Promise.resolve({
        data: handlers.variants ?? [],
        error: null,
      });
    }
    throw new Error(`Unexpected rpc: ${name}`);
  };

  return { from, rpc } as unknown as SupabaseClient;
}

describe('computeAgenticOrderTax', () => {
  it('returns 0 when the merchant is not VAT-registered', async () => {
    const supabase = buildSupabaseMock({
      merchant: { vat_registration_status: 'not_registered' },
    });

    const result = await computeAgenticOrderTax({
      items: [{ product_id: 'prod-1', quantity: 2 }],
      merchantId: 'm-1',
      supabase,
    });

    expect(result).toBe(0);
  });

  it('returns 0 when items[] is empty', async () => {
    const supabase = buildSupabaseMock({
      merchant: { vat_registration_status: 'registered' },
    });

    const result = await computeAgenticOrderTax({
      items: [],
      merchantId: 'm-1',
      supabase,
    });

    expect(result).toBe(0);
  });

  it("computes per-line tax for a single 'S' product at the merchant's default rate", async () => {
    // Product price 10000, qty 2, category 'S', rate 7.5
    // line_extension = ROUND(2 * 10000, 2) = 20000
    // tax = ROUND(20000 * 7.5 / 100, 2) = 1500
    const supabase = buildSupabaseMock({
      merchant: { vat_registration_status: 'registered' },
      products: [
        {
          id: 'prod-1',
          price: 10000,
          vat_category_code: 'S',
          vat_rate: 7.5,
        },
      ],
    });

    const result = await computeAgenticOrderTax({
      items: [{ product_id: 'prod-1', quantity: 2 }],
      merchantId: 'm-1',
      supabase,
    });

    expect(result).toBe(1500);
  });

  it("treats NULL vat_category_code as 'S' (column default)", async () => {
    // Mirrors `populate_order_item_tax`: when product.vat_category_code
    // IS NULL, NEW.vat_category_code stays at the order_items column
    // default 'S' and the trigger charges VAT. Round 4 regression.
    const supabase = buildSupabaseMock({
      merchant: { vat_registration_status: 'registered' },
      products: [
        {
          id: 'prod-1',
          price: 1000,
          vat_category_code: null,
          vat_rate: 7.5,
        },
      ],
    });

    const result = await computeAgenticOrderTax({
      items: [{ product_id: 'prod-1', quantity: 1 }],
      merchantId: 'm-1',
      supabase,
    });

    expect(result).toBe(75);
  });

  it('treats NULL vat_rate as 7.5 (column default, not merchant rate)', async () => {
    // Same trigger semantics: NEW.vat_rate falls back to the column
    // default 7.5, NOT the merchant's configured rate. Mirroring
    // exactly so RPC + dispatch agree.
    const supabase = buildSupabaseMock({
      merchant: { vat_registration_status: 'registered' },
      products: [
        {
          id: 'prod-1',
          price: 2000,
          vat_category_code: 'S',
          vat_rate: null,
        },
      ],
    });

    const result = await computeAgenticOrderTax({
      items: [{ product_id: 'prod-1', quantity: 1 }],
      merchantId: 'm-1',
      supabase,
    });

    expect(result).toBe(150); // ROUND(2000 * 7.5 / 100, 2)
  });

  it("contributes 0 for non-'S' categories (O / Z / exempt)", async () => {
    // Mixed-category cart: 'S' contributes, 'O' does not.
    const supabase = buildSupabaseMock({
      merchant: { vat_registration_status: 'registered' },
      products: [
        {
          id: 'prod-s',
          price: 1000,
          vat_category_code: 'S',
          vat_rate: 7.5,
        },
        {
          id: 'prod-o',
          price: 5000,
          vat_category_code: 'O',
          vat_rate: 7.5,
        },
      ],
    });

    const result = await computeAgenticOrderTax({
      items: [
        { product_id: 'prod-s', quantity: 1 }, // 75
        { product_id: 'prod-o', quantity: 1 }, // 0
      ],
      merchantId: 'm-1',
      supabase,
    });

    expect(result).toBe(75);
  });

  it('falls back to product base price when the variant belongs to a DIFFERENT product (high finding)', async () => {
    // High finding (PR #1622 review): the RPC's LEFT JOIN enforces
    // `v.product_id = p.id` and falls back to base price when the
    // variant_id is from a different product. The helper must mirror
    // this — otherwise a spoofed cross-product variant_id would
    // apply the wrong override, helper and RPC would compute
    // different tax, and the parity guard would 400 a legitimate
    // call.
    const supabase = buildSupabaseMock({
      merchant: { vat_registration_status: 'registered' },
      products: [
        {
          id: 'prod-1',
          price: 1000,
          vat_category_code: 'S',
          vat_rate: 7.5,
        },
        {
          id: 'prod-2',
          price: 9000,
          vat_category_code: 'S',
          vat_rate: 7.5,
        },
      ],
      variants: [
        // var-X belongs to prod-2, NOT prod-1.
        { id: 'var-X', product_id: 'prod-2', price_override: 5000 },
      ],
    });

    const result = await computeAgenticOrderTax({
      // Caller claims prod-1 + var-X (a variant of prod-2).
      items: [{ product_id: 'prod-1', variant_id: 'var-X', quantity: 1 }],
      merchantId: 'm-1',
      supabase,
    });

    // Expected: prod-1.base_price wins (cross-product variant
    // ignored), tax = ROUND(1000 * 7.5 / 100, 2) = 75. Without the
    // mirror, the helper would have used var-X.price_override (5000)
    // → 375 → mismatch with RPC's base-price calc.
    expect(result).toBe(75);
  });

  it('uses variant.price_override when variant matches the same product', async () => {
    // Mirrors RPC: COALESCE(t.price_override, t.base_price). The
    // variant override (5000) wins over the product price (1000)
    // when variant.product_id matches the order line's product_id.
    const supabase = buildSupabaseMock({
      merchant: { vat_registration_status: 'registered' },
      products: [
        {
          id: 'prod-1',
          price: 1000,
          vat_category_code: 'S',
          vat_rate: 7.5,
        },
      ],
      variants: [{ id: 'var-1', product_id: 'prod-1', price_override: 5000 }],
    });

    const result = await computeAgenticOrderTax({
      items: [{ product_id: 'prod-1', variant_id: 'var-1', quantity: 1 }],
      merchantId: 'm-1',
      supabase,
    });

    expect(result).toBe(375); // ROUND(5000 * 7.5 / 100, 2)
  });

  it('taxes offer lines from the live offer price (RPC parity)', async () => {
    // Mirrors RPC: COALESCE(t.price_override, t.offer_price, t.base_price).
    // The live offer (4000) wins over the parent price (10000) for the
    // offer line; without it the route/RPC disagree and the order trips
    // tax_amount_mismatch.
    const supabase = buildSupabaseMock({
      merchant: { vat_registration_status: 'registered' },
      products: [
        {
          id: 'prod-1',
          price: 10000,
          vat_category_code: 'S',
          vat_rate: 7.5,
        },
      ],
    });

    const result = await computeAgenticOrderTax({
      items: [{ product_id: 'prod-1', offer_id: 'offer-1', quantity: 1 }],
      merchantId: 'm-1',
      offerPrices: new Map([['prod-1::offer-1', 4000]]),
      supabase,
    });

    expect(result).toBe(300); // ROUND(4000 * 7.5 / 100, 2)
  });

  it('prefers the variant override over the live offer price', async () => {
    const supabase = buildSupabaseMock({
      merchant: { vat_registration_status: 'registered' },
      products: [
        {
          id: 'prod-1',
          price: 10000,
          vat_category_code: 'S',
          vat_rate: 10,
        },
      ],
      variants: [{ id: 'var-1', product_id: 'prod-1', price_override: 5000 }],
    });

    const result = await computeAgenticOrderTax({
      items: [
        {
          product_id: 'prod-1',
          variant_id: 'var-1',
          offer_id: 'offer-1',
          quantity: 1,
        },
      ],
      merchantId: 'm-1',
      offerPrices: new Map([['prod-1::offer-1', 4000]]),
      supabase,
    });

    expect(result).toBe(500); // ROUND(5000 * 10 / 100, 2)
  });

  it('skips items whose product cannot be resolved', async () => {
    // Defensive: a stale product_id in the payload doesn't blow up
    // — the RPC will reject with `invalid_items` separately. The
    // helper just contributes 0 for the missing line.
    const supabase = buildSupabaseMock({
      merchant: { vat_registration_status: 'registered' },
      products: [
        {
          id: 'prod-1',
          price: 1000,
          vat_category_code: 'S',
          vat_rate: 7.5,
        },
      ],
    });

    const result = await computeAgenticOrderTax({
      items: [
        { product_id: 'prod-1', quantity: 1 }, // 75
        { product_id: 'prod-missing', quantity: 5 }, // 0
      ],
      merchantId: 'm-1',
      supabase,
    });

    expect(result).toBe(75);
  });

  it('skips items with non-positive quantity or price', async () => {
    const supabase = buildSupabaseMock({
      merchant: { vat_registration_status: 'registered' },
      products: [
        {
          id: 'prod-zero-price',
          price: 0,
          vat_category_code: 'S',
          vat_rate: 7.5,
        },
        {
          id: 'prod-valid',
          price: 1000,
          vat_category_code: 'S',
          vat_rate: 7.5,
        },
      ],
    });

    const result = await computeAgenticOrderTax({
      items: [
        { product_id: 'prod-zero-price', quantity: 1 }, // 0
        { product_id: 'prod-valid', quantity: 0 }, // 0
        { product_id: 'prod-valid', quantity: 1 }, // 75
      ],
      merchantId: 'm-1',
      supabase,
    });

    expect(result).toBe(75);
  });

  it('scopes the products query to merchant_id (high finding)', async () => {
    // High finding (PR #1622 review): products has a public-read
    // policy (`status = 'active' OR has_merchant_access`), so a
    // caller passing a cross-tenant product_id could leak prices /
    // VAT from a different merchant if the SELECT isn't scoped. Pin
    // that the helper's products query chains `.eq('merchant_id',
    // <merchantId>)` before `.in('id', ...)`.
    const eqSpy = vi.fn();
    const supabase = {
      from: (table: string) => {
        if (table === 'merchants') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: { vat_registration_status: 'registered' },
                    error: null,
                  }),
              }),
            }),
          };
        }
        if (table === 'products') {
          return {
            select: () => ({
              eq: (column: string, value: string) => {
                eqSpy(column, value);
                return {
                  in: () => ({
                    returns: () => Promise.resolve({ data: [], error: null }),
                  }),
                };
              },
            }),
          };
        }
        throw new Error('unexpected');
      },
      rpc: () => Promise.resolve({ data: [], error: null }),
    } as unknown as SupabaseClient;

    await computeAgenticOrderTax({
      items: [{ product_id: 'prod-1', quantity: 1 }],
      merchantId: 'merchant-A',
      supabase,
    });

    expect(eqSpy).toHaveBeenCalledWith('merchant_id', 'merchant-A');
  });

  it('throws a TaxComputeError tagged with pg code 22P02 for malformed item ids (Codex P2)', async () => {
    // Postgres returns code 22P02 when a non-UUID string is passed
    // into a `uuid[]` parameter (the `.in('id', productIds)` path).
    // Callers (route + dispatch) must be able to detect this and
    // map to 400 instead of treating it as a server outage.
    const supabase = {
      from: (table: string) => {
        if (table === 'merchants') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: { vat_registration_status: 'registered' },
                    error: null,
                  }),
              }),
            }),
          };
        }
        if (table === 'products') {
          return {
            select: () => ({
              eq: () => ({
                in: () => ({
                  returns: () =>
                    Promise.resolve({
                      data: null,
                      error: {
                        code: '22P02',
                        message:
                          'invalid input syntax for type uuid: "not-a-uuid"',
                      },
                    }),
                }),
              }),
            }),
          };
        }
        throw new Error('unexpected');
      },
    } as unknown as SupabaseClient;

    await expect(
      computeAgenticOrderTax({
        items: [{ product_id: 'not-a-uuid', quantity: 1 }],
        merchantId: 'm-1',
        supabase,
      })
    ).rejects.toMatchObject({
      name: 'TaxComputeError',
      pgCode: '22P02',
    });
  });

  it('isTaxComputeUuidError returns true ONLY for TaxComputeError with pgCode 22P02', () => {
    expect(isTaxComputeUuidError(new TaxComputeError('boom', '22P02'))).toBe(
      true
    );
    expect(isTaxComputeUuidError(new TaxComputeError('boom', '23505'))).toBe(
      false
    );
    expect(isTaxComputeUuidError(new TaxComputeError('boom'))).toBe(false);
    expect(isTaxComputeUuidError(new Error('boom'))).toBe(false);
    expect(isTaxComputeUuidError(null)).toBe(false);
    expect(isTaxComputeUuidError(undefined)).toBe(false);
  });

  it('throws when the merchants lookup returns an error (Codex P2)', async () => {
    // A transient DB/RLS failure used to be swallowed as "not
    // registered" → tax 0 → RPC tax_amount_mismatch → 400. That
    // hid infra errors and broke retry semantics. Now we throw
    // so the dispatch surfaces a 500.
    const supabase = {
      from: (table: string) => {
        if (table === 'merchants') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: null,
                    error: { message: 'connection timeout' },
                  }),
              }),
            }),
          };
        }
        throw new Error('should not query products on merchant error');
      },
    } as unknown as SupabaseClient;

    await expect(
      computeAgenticOrderTax({
        items: [{ product_id: 'prod-1', quantity: 1 }],
        merchantId: 'm-1',
        supabase,
      })
    ).rejects.toThrow(/Failed to load merchant VAT status/);
  });

  it('throws when the products lookup returns an error (Codex P2)', async () => {
    const supabase = {
      from: (table: string) => {
        if (table === 'merchants') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: { vat_registration_status: 'registered' },
                    error: null,
                  }),
              }),
            }),
          };
        }
        if (table === 'products') {
          return {
            select: () => ({
              eq: () => ({
                in: () => ({
                  returns: () =>
                    Promise.resolve({
                      data: null,
                      error: { message: 'rls deny' },
                    }),
                }),
              }),
            }),
          };
        }
        throw new Error('unexpected');
      },
    } as unknown as SupabaseClient;

    await expect(
      computeAgenticOrderTax({
        items: [{ product_id: 'prod-1', quantity: 1 }],
        merchantId: 'm-1',
        supabase,
      })
    ).rejects.toThrow(/Failed to load products for VAT computation/);
  });

  it('throws when get_order_variant_overrides returns an error (Codex P2)', async () => {
    const supabase = {
      from: (table: string) => {
        if (table === 'merchants') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: { vat_registration_status: 'registered' },
                    error: null,
                  }),
              }),
            }),
          };
        }
        if (table === 'products') {
          return {
            select: () => ({
              eq: () => ({
                in: () => ({
                  returns: () =>
                    Promise.resolve({
                      data: [
                        {
                          id: 'prod-1',
                          price: 1000,
                          vat_category_code: 'S',
                          vat_rate: 7.5,
                        },
                      ],
                      error: null,
                    }),
                }),
              }),
            }),
          };
        }
        throw new Error('unexpected');
      },
      rpc: (name: string) => {
        if (name === 'get_order_variant_overrides') {
          return Promise.resolve({
            data: null,
            error: { message: 'variants rpc failed' },
          });
        }
        throw new Error('unexpected rpc');
      },
    } as unknown as SupabaseClient;

    await expect(
      computeAgenticOrderTax({
        items: [{ product_id: 'prod-1', variant_id: 'var-1', quantity: 1 }],
        merchantId: 'm-1',
        supabase,
      })
    ).rejects.toThrow(/Failed to load product variants for VAT computation/);
  });

  it('throws TaxComputeError with product context when vat_rate is invalid (CodeRabbit round 7)', async () => {
    // Round 7: previously the helper silently skipped lines with
    // non-finite/negative rates, producing a smaller expected_tax
    // than the trigger and a confusing `tax_amount_mismatch` 400
    // with no breadcrumb. Now it throws with the product id so
    // ops can find the bad row immediately.
    const supabase = buildSupabaseMock({
      merchant: { vat_registration_status: 'registered' },
      products: [
        {
          id: 'prod-bad-rate',
          price: 1000,
          vat_category_code: 'S',
          vat_rate: Number.NaN,
        },
      ],
    });

    await expect(
      computeAgenticOrderTax({
        items: [{ product_id: 'prod-bad-rate', quantity: 1 }],
        merchantId: 'm-1',
        supabase,
      })
    ).rejects.toMatchObject({
      name: 'TaxComputeError',
      message: expect.stringContaining('prod-bad-rate'),
    });
  });

  it('does not query products when the merchant lookup returns nothing', async () => {
    // Defensive: a deleted merchant id (race) returns null. We
    // treat that as not-registered and return 0 without further
    // queries — matches the RPC's "non-registered → tax_amount = 0"
    // semantics.
    const productsSelect = vi.fn();
    const supabase = {
      from: (table: string) => {
        if (table === 'merchants') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: null, error: null }),
              }),
            }),
          };
        }
        if (table === 'products') {
          productsSelect();
          return {
            select: () => ({
              eq: () => ({
                in: () => ({
                  returns: () => Promise.resolve({ data: [], error: null }),
                }),
              }),
            }),
          };
        }
        throw new Error('unexpected');
      },
    } as unknown as SupabaseClient;

    const result = await computeAgenticOrderTax({
      items: [{ product_id: 'prod-1', quantity: 1 }],
      merchantId: 'missing-merchant',
      supabase,
    });

    expect(result).toBe(0);
    expect(productsSelect).not.toHaveBeenCalled();
  });
});
