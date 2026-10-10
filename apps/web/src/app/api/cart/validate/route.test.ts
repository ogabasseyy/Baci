import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkCsrfProtection } from '@/lib/csrf';
import { POST } from './route';

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: vi.fn().mockResolvedValue({ valid: true }),
}));

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_PRODUCT_ID = '22222222-2222-4222-8222-222222222222';
const VARIANT_ID = '33333333-3333-4333-8333-333333333333';
const BAD_VARIANT_ID = '44444444-4444-4444-8444-444444444444';
const OFFER_ID = '55555555-5555-4555-8555-555555555555';
const OTHER_OFFER_ID = '66666666-6666-4666-8666-666666666666';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  products: [] as unknown[],
  productError: null as { message: string } | null,
  variants: [] as unknown[],
  variantError: null as { message: string } | null,
  offers: [] as unknown[],
  offerError: null as { message: string } | null,
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
    rpc: vi.fn((name: string) =>
      name === 'get_product_offers'
        ? Promise.resolve({ data: mocks.offers, error: mocks.offerError })
        : Promise.resolve({ data: mocks.variants, error: mocks.variantError })
    ),
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

describe('POST /api/cart/validate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.products = [];
    mocks.productError = null;
    mocks.variants = [];
    mocks.variantError = null;
    mocks.offers = [];
    mocks.offerError = null;
  });

  it('returns 403 for invalid CSRF token', async () => {
    vi.mocked(checkCsrfProtection).mockResolvedValueOnce({
      valid: false,
      response: NextResponse.json(
        { error: 'CSRF validation failed' },
        { status: 403 }
      ),
    });

    const response = await postCartValidate({
      cartItems: [{ id: PRODUCT_ID, price: 370_000 }],
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('CSRF validation failed');
  });

  it('returns 400 for invalid request body', async () => {
    const { supabase } = buildSupabaseMock();
    mocks.createClient.mockResolvedValue(supabase);

    const response = await postCartValidate({
      cartItems: [{ id: PRODUCT_ID, price: '370000' }],
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Invalid request body');
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('falls back to productIds when cartItems is empty', async () => {
    const { supabase, productsQuery } = buildSupabaseMock();
    mocks.createClient.mockResolvedValue(supabase);
    mocks.products = [
      {
        id: PRODUCT_ID,
        name: 'iPhone 15',
        price: 370_000,
        stock: 5,
        stock_quantity: 5,
        status: 'active',
        manage_stock: true,
      },
    ];

    const response = await postCartValidate({
      productIds: [PRODUCT_ID],
      cartItems: [],
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(productsQuery.in).toHaveBeenCalledWith('id', [PRODUCT_ID]);
    expect(body.validProducts).toEqual([
      {
        id: PRODUCT_ID,
        price: 370_000,
        stock: 5,
        name: 'iPhone 15',
        manage_stock: true,
      },
    ]);
  });

  it('normalizes a null manage_stock row to managed inventory', async () => {
    const { supabase } = buildSupabaseMock();
    mocks.createClient.mockResolvedValue(supabase);
    mocks.products = [
      {
        id: PRODUCT_ID,
        name: 'Legacy Phone',
        price: 370_000,
        stock: 0,
        stock_quantity: 0,
        status: 'active',
        manage_stock: null,
      },
    ];

    const response = await postCartValidate({
      productIds: [PRODUCT_ID],
      cartItems: [],
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.validProducts).toEqual([
      {
        id: PRODUCT_ID,
        price: 370_000,
        stock: 0,
        name: 'Legacy Phone',
        manage_stock: true,
      },
    ]);
  });

  it('reports stale selected-variant prices against the variant override', async () => {
    const { supabase, productsQuery } = buildSupabaseMock();
    mocks.createClient.mockResolvedValue(supabase);
    mocks.products = [
      {
        id: PRODUCT_ID,
        name: 'iPhone 15',
        price: 370_000,
        stock: 5,
        stock_quantity: 5,
        status: 'active',
        manage_stock: true,
      },
    ];
    mocks.variants = [
      {
        id: VARIANT_ID,
        product_id: PRODUCT_ID,
        price_override: 320_000,
      },
    ];

    const response = await postCartValidate({
      cartItems: [
        {
          id: PRODUCT_ID,
          price: 370_000,
          variantId: VARIANT_ID,
        },
      ],
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(supabase.from).toHaveBeenCalledWith('products');
    expect(productsQuery.in).toHaveBeenCalledWith('id', [PRODUCT_ID]);
    expect(supabase.from).not.toHaveBeenCalledWith('product_variants');
    expect(supabase.rpc).toHaveBeenCalledWith(
      'get_storefront_product_variants',
      {
        p_product_ids: [PRODUCT_ID],
      }
    );
    expect(body.priceChanges).toEqual([
      {
        id: PRODUCT_ID,
        variantId: VARIANT_ID,
        oldPrice: 370_000,
        newPrice: 320_000,
      },
    ]);
    expect(body.validProducts[0]).toMatchObject({
      id: PRODUCT_ID,
      price: 320_000,
      variantId: VARIANT_ID,
    });
  });

  it('invalidates only the mismatched variant line key', async () => {
    const { supabase } = buildSupabaseMock();
    mocks.createClient.mockResolvedValue(supabase);
    mocks.products = [
      {
        id: PRODUCT_ID,
        name: 'iPhone 15',
        price: 370_000,
        stock: 5,
        stock_quantity: 5,
        status: 'active',
        manage_stock: true,
      },
    ];
    mocks.variants = [
      {
        id: VARIANT_ID,
        product_id: PRODUCT_ID,
        price_override: 320_000,
      },
    ];

    const response = await postCartValidate({
      cartItems: [
        {
          id: PRODUCT_ID,
          price: 370_000,
          variantId: VARIANT_ID,
        },
        {
          id: PRODUCT_ID,
          price: 370_000,
          variantId: BAD_VARIANT_ID,
        },
      ],
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.invalidProductIds).toEqual([
      `${PRODUCT_ID}::${BAD_VARIANT_ID}`,
    ]);
    expect(body.priceChanges).toEqual([
      {
        id: PRODUCT_ID,
        variantId: VARIANT_ID,
        oldPrice: 370_000,
        newPrice: 320_000,
      },
    ]);
  });

  it('keeps variant price changes scoped to the matching product variant', async () => {
    const { supabase } = buildSupabaseMock();
    mocks.createClient.mockResolvedValue(supabase);
    mocks.products = [
      {
        id: PRODUCT_ID,
        name: 'iPhone 15',
        price: 370_000,
        stock: 5,
        stock_quantity: 5,
        status: 'active',
        manage_stock: true,
      },
      {
        id: OTHER_PRODUCT_ID,
        name: 'iPhone 15 Pro',
        price: 780_000,
        stock: 5,
        stock_quantity: 5,
        status: 'active',
        manage_stock: true,
      },
    ];
    mocks.variants = [
      {
        id: VARIANT_ID,
        product_id: PRODUCT_ID,
        price_override: 320_000,
      },
    ];

    const response = await postCartValidate({
      cartItems: [
        {
          id: PRODUCT_ID,
          price: 370_000,
          variantId: VARIANT_ID,
        },
        {
          id: OTHER_PRODUCT_ID,
          price: 780_000,
          variantId: VARIANT_ID,
        },
      ],
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.invalidProductIds).toEqual([
      `${OTHER_PRODUCT_ID}::${VARIANT_ID}`,
    ]);
    expect(body.priceChanges).toEqual([
      {
        id: PRODUCT_ID,
        variantId: VARIANT_ID,
        oldPrice: 370_000,
        newPrice: 320_000,
      },
    ]);
  });

  it('returns 500 when variant prices cannot be loaded', async () => {
    const { supabase } = buildSupabaseMock();
    mocks.createClient.mockResolvedValue(supabase);
    mocks.products = [
      {
        id: PRODUCT_ID,
        name: 'iPhone 15',
        price: 370_000,
        stock: 5,
        stock_quantity: 5,
        status: 'active',
        manage_stock: true,
      },
    ];
    mocks.variantError = { message: 'variant query failed' };

    const response = await postCartValidate({
      cartItems: [
        {
          id: PRODUCT_ID,
          price: 370_000,
          variantId: VARIANT_ID,
        },
      ],
    });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toContain('variant query failed');
  });

  it('keeps offer lines priced at the live offer instead of the parent', async () => {
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
        offer_id: OFFER_ID,
        condition: 'used',
        price: 400_000,
        stock_quantity: 3,
      },
      {
        offer_id: OTHER_OFFER_ID,
        condition: 'used',
        price: 420_000,
        stock_quantity: 2,
      },
    ];

    const response = await postCartValidate({
      cartItems: [
        { id: PRODUCT_ID, price: 400_000, offerId: OFFER_ID },
        { id: PRODUCT_ID, price: 420_000, offerId: OTHER_OFFER_ID },
      ],
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.invalidProductIds).toEqual([]);
    expect(body.priceChanges).toEqual([]);
    expect(supabase.rpc).toHaveBeenCalledWith('get_product_offers', {
      p_product_id: PRODUCT_ID,
    });
  });

  it('scopes offer price changes to the matching offer line', async () => {
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
      { offer_id: OFFER_ID, condition: 'used', price: 400_000 },
      { offer_id: OTHER_OFFER_ID, condition: 'used', price: 430_000 },
    ];

    const response = await postCartValidate({
      cartItems: [
        { id: PRODUCT_ID, price: 400_000, offerId: OFFER_ID },
        { id: PRODUCT_ID, price: 420_000, offerId: OTHER_OFFER_ID },
      ],
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.priceChanges).toEqual([
      {
        id: PRODUCT_ID,
        offerId: OTHER_OFFER_ID,
        oldPrice: 420_000,
        newPrice: 430_000,
      },
    ]);
    expect(supabase.rpc).toHaveBeenCalledWith('get_product_offers', {
      p_product_id: PRODUCT_ID,
    });
  });

  it('returns 500 when offer prices cannot be loaded', async () => {
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
      },
    ];
    mocks.offerError = { message: 'offer query failed' };

    const response = await postCartValidate({
      cartItems: [{ id: PRODUCT_ID, price: 400_000, offerId: OFFER_ID }],
    });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toContain('offer query failed');
    expect(supabase.rpc).toHaveBeenCalledWith('get_product_offers', {
      p_product_id: PRODUCT_ID,
    });
  });

  it('invalidates only the line whose offer is gone', async () => {
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
    mocks.offers = [{ offer_id: OFFER_ID, condition: 'used', price: 400_000 }];

    const response = await postCartValidate({
      cartItems: [
        { id: PRODUCT_ID, price: 400_000, offerId: OFFER_ID },
        { id: PRODUCT_ID, price: 420_000, offerId: OTHER_OFFER_ID },
      ],
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.invalidProductIds).toEqual([
      `${PRODUCT_ID}::offer=${OTHER_OFFER_ID}`,
    ]);
    expect(body.priceChanges).toEqual([]);
    expect(supabase.rpc).toHaveBeenCalledWith('get_product_offers', {
      p_product_id: PRODUCT_ID,
    });
  });

  it('rejects lines naming both a variant and a condition offer', async () => {
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
      },
    ];
    mocks.variants = [
      {
        id: VARIANT_ID,
        product_id: PRODUCT_ID,
        price_override: 480_000,
      },
    ];
    mocks.offers = [{ offer_id: OFFER_ID, condition: 'used', price: 400_000 }];

    const response = await postCartValidate({
      cartItems: [
        {
          id: PRODUCT_ID,
          price: 480_000,
          variantId: VARIANT_ID,
          offerId: OFFER_ID,
        },
      ],
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.invalidProductIds).toEqual([
      `${PRODUCT_ID}::${VARIANT_ID}::offer=${OFFER_ID}`,
    ]);
    expect(body.validProducts).toEqual([]);
  });

  it('invalidates a live offer when the parent flag is off', async () => {
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
    mocks.offers = [{ offer_id: OFFER_ID, condition: 'used', price: 400_000 }];

    const response = await postCartValidate({
      cartItems: [{ id: PRODUCT_ID, price: 400_000, offerId: OFFER_ID }],
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.invalidProductIds).toEqual([
      `${PRODUCT_ID}::offer=${OFFER_ID}`,
    ]);
    expect(body.validProducts).toEqual([]);
  });

  it('invalidates a live offer on a variant-bearing parent', async () => {
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
        has_variants: true,
        variant_model: 'legacy',
      },
    ];
    mocks.offers = [{ offer_id: OFFER_ID, condition: 'used', price: 400_000 }];

    const response = await postCartValidate({
      cartItems: [{ id: PRODUCT_ID, price: 400_000, offerId: OFFER_ID }],
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.invalidProductIds).toEqual([
      `${PRODUCT_ID}::offer=${OFFER_ID}`,
    ]);
  });

  it('invalidates a live offer when live variants exist for the product', async () => {
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
    // The variants RPC already excludes inventory anchors, so any row
    // here is a live variant failing the parent gate.
    mocks.variants = [{ id: VARIANT_ID, product_id: PRODUCT_ID }];
    mocks.offers = [{ offer_id: OFFER_ID, condition: 'used', price: 400_000 }];

    const response = await postCartValidate({
      cartItems: [{ id: PRODUCT_ID, price: 400_000, offerId: OFFER_ID }],
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.invalidProductIds).toEqual([
      `${PRODUCT_ID}::offer=${OFFER_ID}`,
    ]);
    expect(supabase.rpc).toHaveBeenCalledWith(
      'get_storefront_product_variants',
      { p_product_ids: [PRODUCT_ID] }
    );
  });

  it('invalidates an offer line whose submitted condition drifted', async () => {
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
    mocks.offers = [{ offer_id: OFFER_ID, condition: 'used', price: 400_000 }];

    const response = await postCartValidate({
      cartItems: [
        {
          id: PRODUCT_ID,
          price: 400_000,
          offerId: OFFER_ID,
          condition: 'new',
        },
      ],
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.invalidProductIds).toEqual([
      `${PRODUCT_ID}::offer=${OFFER_ID}`,
    ]);
    expect(body.validProducts).toEqual([]);
  });

  it('keeps an offer line whose submitted condition matches live', async () => {
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
    mocks.offers = [{ offer_id: OFFER_ID, condition: 'used', price: 400_000 }];

    const response = await postCartValidate({
      cartItems: [
        {
          id: PRODUCT_ID,
          price: 400_000,
          offerId: OFFER_ID,
          condition: 'Used',
        },
      ],
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.invalidProductIds).toEqual([]);
    expect(body.validProducts).toHaveLength(1);
  });
});
