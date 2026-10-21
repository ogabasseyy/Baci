import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkCsrfProtection } from '@/lib/csrf';
import { POST } from './route';

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: vi.fn().mockResolvedValue({ valid: true }),
}));

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const OFFER_ID = '55555555-5555-4555-8555-555555555555';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  products: [] as unknown[],
  productError: null as { message: string } | null,
  variants: [] as unknown[],
  variantError: null as { message: string } | null,
  offers: [] as unknown[],
  offerError: null as { message: string } | null,
  baseInventory: [] as unknown[],
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createClient,
}));

function buildSupabaseMock() {
  const productsQuery = {
    select: vi.fn(() => productsQuery),
    in: vi.fn(() => productsQuery),
    returns: vi.fn(() =>
      Promise.resolve({ data: mocks.products, error: mocks.productError })
    ),
  };
  const supabase = {
    from: vi.fn(() => productsQuery),
    rpc: vi.fn((name: string) => {
      if (name === 'get_storefront_offer_resolution') {
        return Promise.resolve({ data: mocks.offers, error: mocks.offerError });
      }
      if (name === 'get_storefront_product_base_inventory') {
        return Promise.resolve({ data: mocks.baseInventory, error: null });
      }
      // The variants lookup pages through .range(); tests hold under
      // one page, so every ranged call resolves the full fixture set.
      return {
        range: vi.fn(() =>
          Promise.resolve({
            data: mocks.variants,
            error: mocks.variantError,
          })
        ),
      };
    }),
  };

  return { productsQuery, supabase };
}

function postCartValidate(body: unknown) {
  return POST(
    new NextRequest('https://example.com/api/cart/validate', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  );
}

describe('POST /api/cart/validate offer authority', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.products = [];
    mocks.productError = null;
    mocks.variants = [];
    mocks.variantError = null;
    mocks.offers = [];
    mocks.offerError = null;
    mocks.baseInventory = [];
  });

  it('accepts a live offer the authority flags as parent-ineligible', async () => {
    const { supabase } = buildSupabaseMock();
    mocks.createClient.mockResolvedValue(supabase);
    mocks.products = [
      {
        id: PRODUCT_ID,
        name: 'iPhone 15',
        price: 500_000,
        stock: 0,
        stock_quantity: 0,
        status: 'active',
        manage_stock: true,
        has_condition_offers: false,
        has_variants: false,
        variant_model: 'legacy',
      },
    ];
    // Transactions mirror the ungated order RPC: a live row is valid
    // whatever parent_eligible says (discovery surfaces filter on it).
    mocks.offers = [
      {
        product_id: PRODUCT_ID,
        offer_id: OFFER_ID,
        condition: 'used',
        price: 400_000,
        parent_eligible: false,
      },
    ];

    const response = await postCartValidate({
      cartItems: [{ id: PRODUCT_ID, price: 400_000, offerId: OFFER_ID }],
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.invalidProductIds).toEqual([]);
    expect(body.validProducts).toHaveLength(1);
    expect(body.validProducts[0]).toMatchObject({
      id: PRODUCT_ID,
      price: 400_000,
    });
  });

  it('skips the variants lookup for offer-only carts', async () => {
    const { supabase } = buildSupabaseMock();
    mocks.createClient.mockResolvedValue(supabase);
    mocks.products = [
      {
        id: PRODUCT_ID,
        name: 'iPhone 15',
        price: 500_000,
        stock: 0,
        stock_quantity: 0,
        status: 'active',
        manage_stock: true,
        has_condition_offers: true,
        has_variants: false,
        variant_model: 'legacy',
      },
    ];
    mocks.offers = [
      {
        product_id: PRODUCT_ID,
        offer_id: OFFER_ID,
        condition: 'used',
        price: 400_000,
        parent_eligible: true,
      },
    ];

    const response = await postCartValidate({
      cartItems: [{ id: PRODUCT_ID, price: 400_000, offerId: OFFER_ID }],
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.invalidProductIds).toEqual([]);
    // The parent gate moved into the authority row, so offer-only carts
    // no longer pay for the variant list.
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      'get_storefront_product_variants',
      expect.anything()
    );
  });
});
