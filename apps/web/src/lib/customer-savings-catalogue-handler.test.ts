import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { savingsDraftFixture } from './customer-savings-draft.test-fixture';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  enabled: vi.fn(),
  failure: vi.fn(),
  from: vi.fn(),
  resolveMerchant: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: mocks.auth }));
vi.mock('@/lib/resolve-wallet-top-up-merchant', () => ({
  resolveWalletTopUpMerchant: mocks.resolveMerchant,
}));
vi.mock('@/lib/customer-savings-draft-request', () => ({
  customerSavingsDraftRequest: {
    enabled: mocks.enabled,
    failure: mocks.failure,
    merchantId: '10000000-0000-4000-8000-000000000001',
  },
}));

import { handleCustomerSavingsCatalogue } from './customer-savings-catalogue-handler';

describe('customer savings catalogue handler', () => {
  const fixture = savingsDraftFixture();
  const endpoint =
    'http://localhost/api/storefront/customer/savings/drafts/catalogue';
  const request = (query = `merchantId=${fixture.merchantId}&search=&page=0`) =>
    new NextRequest(`${endpoint}?${query}`);
  let customerMaybeSingle: ReturnType<typeof vi.fn>;
  let productsRange: ReturnType<typeof vi.fn>;
  let customerUser: ReturnType<typeof vi.fn>;
  let customerMerchant: ReturnType<typeof vi.fn>;
  let productsMerchant: ReturnType<typeof vi.fn>;
  let productsStatus: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    customerMaybeSingle = vi
      .fn()
      .mockResolvedValue({ data: { id: 'customer' }, error: null });
    customerUser = vi
      .fn()
      .mockReturnValue({ maybeSingle: customerMaybeSingle });
    customerMerchant = vi.fn().mockReturnValue({ eq: customerUser });
    productsRange = vi.fn().mockResolvedValue({ data: [], error: null });
    const productsOrderId = vi.fn().mockReturnValue({ range: productsRange });
    const productsOrderName = vi
      .fn()
      .mockReturnValue({ order: productsOrderId });
    productsStatus = vi.fn().mockReturnValue({ order: productsOrderName });
    productsMerchant = vi.fn().mockReturnValue({ eq: productsStatus });
    mocks.from.mockImplementation((table: string) => ({
      select: vi
        .fn()
        .mockReturnValue(
          table === 'customers'
            ? { eq: customerMerchant }
            : { eq: productsMerchant }
        ),
    }));
    mocks.auth.mockResolvedValue({
      user: { id: 'actor' },
      error: null,
      supabase: { from: mocks.from, rpc: mocks.rpc },
    });
    mocks.enabled.mockReturnValue(true);
    mocks.failure.mockImplementation((status: number, code: string) =>
      NextResponse.json(
        { error: 'Savings draft unavailable', code },
        { status, headers: { 'Cache-Control': 'no-store' } }
      )
    );
    mocks.resolveMerchant.mockResolvedValue({ id: fixture.merchantId });
    mocks.rpc.mockResolvedValue({ data: [], error: null });
  });

  afterEach(() => vi.restoreAllMocks());

  it('authenticates before checking runtime, input, or database access', async () => {
    mocks.auth.mockResolvedValue({ user: null, error: 'private auth failure' });

    expect((await handleCustomerSavingsCatalogue(request())).status).toBe(401);
    expect(mocks.enabled).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('refuses a disabled runtime before database access', async () => {
    mocks.enabled.mockReturnValue(false);

    expect((await handleCustomerSavingsCatalogue(request())).status).toBe(403);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('refuses a non-synthetic merchant without database access', async () => {
    expect(
      (
        await handleCustomerSavingsCatalogue(
          request(
            'merchantId=20000000-0000-4000-8000-000000000001&search=&page=0'
          )
        )
      ).status
    ).toBe(403);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.resolveMerchant).not.toHaveBeenCalled();
  });

  it.each([
    `merchantId=${fixture.merchantId}&merchantId=${fixture.merchantId}&search=&page=0`,
    `merchantId=${fixture.merchantId}&search=&page=0&unexpected=true`,
    `merchantId=${fixture.merchantId}&search=&page=-1`,
  ])('rejects duplicate or malformed catalogue query %s', async (query) => {
    expect((await handleCustomerSavingsCatalogue(request(query))).status).toBe(
      400
    );
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('returns 404 when no customer belongs to the authenticated user and merchant', async () => {
    customerMaybeSingle.mockResolvedValue({ data: null, error: null });

    expect((await handleCustomerSavingsCatalogue(request())).status).toBe(404);
    expect(mocks.from).toHaveBeenCalledWith('customers');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('redacts customer, product, and variant database failures as 503', async () => {
    customerMaybeSingle.mockResolvedValue({
      data: null,
      error: { message: 'private' },
    });
    let response = await handleCustomerSavingsCatalogue(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'Savings draft unavailable',
      code: 'SAVINGS_DRAFT_UNAVAILABLE',
    });

    customerMaybeSingle.mockResolvedValue({
      data: { id: 'customer' },
      error: null,
    });
    productsRange.mockResolvedValue({
      data: null,
      error: { message: 'private' },
    });
    response = await handleCustomerSavingsCatalogue(request());
    expect(response.status).toBe(503);

    productsRange.mockResolvedValue({ data: [product(fixture)], error: null });
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'private' } });
    expect((await handleCustomerSavingsCatalogue(request())).status).toBe(503);
  });

  it('returns validated products with only their matching variants', async () => {
    const productRecord = product(fixture);
    productsRange.mockResolvedValue({ data: [productRecord], error: null });
    mocks.rpc.mockResolvedValue({
      data: [
        {
          ...fixture.record.catalogue.variants[0],
          product_id: productRecord.id,
        },
        {
          ...fixture.record.catalogue.variants[0],
          id: '70000000-0000-4000-8000-000000000001',
          product_id: '80000000-0000-4000-8000-000000000001',
        },
      ],
      error: null,
    });

    const response = await handleCustomerSavingsCatalogue(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(customerMerchant).toHaveBeenCalledWith(
      'merchant_id',
      fixture.merchantId
    );
    expect(customerUser).toHaveBeenCalledWith('user_id', 'actor');
    expect(productsMerchant).toHaveBeenCalledWith(
      'merchant_id',
      fixture.merchantId
    );
    expect(productsStatus).toHaveBeenCalledWith('status', 'active');
    expect(productsRange).toHaveBeenCalledWith(0, 19);
    expect(mocks.resolveMerchant).toHaveBeenCalledWith(
      expect.objectContaining({ from: mocks.from }),
      { merchantId: fixture.merchantId },
      'id'
    );
    expect(mocks.rpc).toHaveBeenCalledWith('get_storefront_product_variants', {
      p_product_ids: [fixture.record.productId],
    });
    expect((await response.json()).products[0]).toMatchObject({
      id: fixture.record.productId,
      variants: [fixture.record.catalogue.variants[0]],
    });
  });

  it('escapes wildcard search and preserves bounded pagination', async () => {
    const ilike = vi.fn().mockResolvedValue({ data: [], error: null });
    productsRange.mockReturnValue({ ilike });
    const query = new URLSearchParams({
      merchantId: fixture.merchantId,
      search: '50%_phone',
      page: '2',
    });
    expect(
      (await handleCustomerSavingsCatalogue(request(query.toString()))).status
    ).toBe(200);
    expect(ilike).toHaveBeenCalledWith('name', '%50\\%\\_phone%');
    expect(productsRange).toHaveBeenCalledWith(40, 59);
  });

  it('returns an empty catalogue without calling the variants RPC', async () => {
    const response = await handleCustomerSavingsCatalogue(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ products: [] });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

function product(fixture: ReturnType<typeof savingsDraftFixture>) {
  return {
    id: fixture.record.productId,
    name: fixture.record.catalogue.name,
    price: fixture.record.catalogue.price,
    images: fixture.record.catalogue.images,
    condition: fixture.record.catalogue.condition,
    has_variants: true,
  };
}
