import { beforeEach, describe, expect, it, vi } from 'vitest';
import { finalizeAgenticCheckoutPayment } from '@/lib/agentic/checkout-completion-finalize';
import {
  createAgenticCheckoutOrder,
  markAgenticCheckoutOrderCanceled,
  sendAgenticOrderCreatedWebhook,
} from '@/lib/agentic/checkout-order-dispatch';
import { buildOrderFinalizationClaim } from '@/lib/agentic/checkout-order-finalization-claim';
import { storeAgenticIdempotencyResponse } from '@/lib/agentic/idempotency';
import { logger } from '@/lib/logger';
import { productCacheRevalidation } from '@/lib/product-cache-revalidation';

vi.mock('@/lib/agentic/checkout-order-dispatch', () => ({
  createAgenticCheckoutOrder: vi.fn(),
  markAgenticCheckoutOrderCanceled: vi.fn(),
  sendAgenticOrderCreatedWebhook: vi.fn(),
}));

vi.mock('@/lib/agentic/idempotency', () => ({
  storeAgenticIdempotencyResponse: vi.fn(),
}));

vi.mock('@/lib/product-cache-revalidation', () => ({
  productCacheRevalidation: {
    revalidateDashboard: vi.fn(),
    revalidateProductSlugs: vi.fn(),
    revalidateProducts: vi.fn(),
  },
}));

const { revalidateDashboard, revalidateProductSlugs, revalidateProducts } =
  productCacheRevalidation;

const buyer = {
  email: 'buyer@example.com',
  first_name: 'Ada',
  last_name: 'Lovelace',
  phone_number: '+2348012345678',
};

const dvaAccount = {
  account_name: 'Ada Lovelace',
  account_number: '1234567890',
  bank_name: 'Paystack-Titan',
};

const sessionCalc = {
  lineItems: [
    {
      id: 'line_product-1',
      item: {
        id: 'product-1',
        product_id: 'product-1',
        quantity: 1,
        title: 'Phone',
      },
      base_amount: 500000,
      discount: 0,
      subtotal: 500000,
      tax: 0,
      total: 500000,
    },
  ],
  totals: [{ type: 'total' as const, display_text: 'Total', amount: 500000 }],
  fulfillmentOptions: [],
  selectedOptionId: 'pickup_store_1',
  messages: [],
};

function createUpdateChain(
  data: Record<string, unknown> | null,
  error: unknown = null
) {
  const chain = {
    contains: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    is: vi.fn(),
    select: vi.fn(),
  };
  chain.contains.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.in.mockReturnValue(chain);
  chain.is.mockReturnValue(chain);
  chain.select.mockReturnValue({
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  });

  return chain;
}

function createProductsChain(
  data: Array<{
    id?: string;
    inventory_tracking_policy?: string | null;
    manage_stock: boolean | null;
    slug: string;
  }> | null = [],
  error: unknown = null
) {
  const chain: {
    eq: ReturnType<typeof vi.fn>;
    in: ReturnType<typeof vi.fn>;
    returns: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
  } = {
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    returns: vi.fn().mockResolvedValue({ data, error }),
    select: vi.fn(() => chain),
  };
  return chain;
}

function createVariantsChain() {
  const chain: {
    eq: ReturnType<typeof vi.fn>;
    in: ReturnType<typeof vi.fn>;
    returns: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
  } = {
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    returns: vi.fn().mockResolvedValue({ data: [], error: null }),
    select: vi.fn(() => chain),
  };
  return chain;
}

function createSupabaseWithUpdateChains(
  chains: ReturnType<typeof createUpdateChain>[],
  productsChain: ReturnType<typeof createProductsChain> = createProductsChain([
    { id: 'product-1', manage_stock: true, slug: 'product-1-slug' },
  ]),
  variantsChain = createVariantsChain()
) {
  const update = vi.fn(() => {
    const chain = chains.shift();
    if (!chain) {
      throw new Error('Unexpected checkout_sessions update');
    }
    return chain;
  });

  return {
    from: vi.fn((table: string) => {
      if (table === 'orders') {
        const chain = {
          select: vi.fn(),
          eq: vi.fn(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { payment_status: 'pending', shipping_status: 'pending' },
            error: null,
          }),
        };
        chain.select.mockReturnValue(chain);
        chain.eq.mockReturnValue(chain);
        return chain;
      }
      if (table === 'products') {
        return productsChain;
      }
      if (table === 'product_variants') {
        return variantsChain;
      }
      if (table !== 'checkout_sessions') {
        throw new Error(`Unexpected table ${table}`);
      }
      return { update };
    }),
    update,
  };
}

function finalizeInput(
  supabase: unknown,
  overrides: {
    expectedSessionUpdatedAt?: string;
    finalizationClaimOverride?: string;
    orderSessionCalc?: typeof sessionCalc;
  } = {}
) {
  return {
    buyer,
    dvaAccount,
    expectedSessionUpdatedAt: overrides.expectedSessionUpdatedAt,
    finalizationClaimOverride: overrides.finalizationClaimOverride,
    idempotencyKey: 'idem-1',
    merchantId: 'merchant-1',
    metadata: { agentic: { payment_state: 'payment_account_ready' } },
    orderSession: {
      currency: 'NGN',
      merchant_id: 'merchant-1',
      session_id: 'agentic_session_1',
      shipping_address: { city: 'Lagos' },
    },
    orderSessionCalc: overrides.orderSessionCalc ?? sessionCalc,
    requestId: 'req_123',
    route: 'checkout_sessions.complete',
    sessionId: 'agentic_session_1',
    supabase: supabase as never,
  };
}

describe('finalizeAgenticCheckoutPayment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(markAgenticCheckoutOrderCanceled).mockResolvedValue({
      error: null,
      updated: true,
    });
    vi.mocked(storeAgenticIdempotencyResponse).mockResolvedValue({
      error: null,
      ok: true,
    });
  });

  it('does not create an order when the finalization claim is already taken', async () => {
    const claimChain = createUpdateChain(null);
    const supabase = createSupabaseWithUpdateChains([claimChain]);

    const response = await finalizeAgenticCheckoutPayment(
      finalizeInput(supabase)
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      error: 'Session finalization already in progress',
    });
    expect(createAgenticCheckoutOrder).not.toHaveBeenCalled();
    expect(revalidateProducts).not.toHaveBeenCalled();
    expect(revalidateProductSlugs).not.toHaveBeenCalled();
    expect(storeAgenticIdempotencyResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'idem-1',
        response: expect.objectContaining({
          error: 'Session finalization already in progress',
        }),
        route: 'checkout_sessions.complete',
        status: 409,
      })
    );
  });

  it('uses an operator-proved stored claim and compare-and-set timestamp', async () => {
    const claimChain = createUpdateChain({ session_id: 'agentic_session_1' });
    const markerChain = createUpdateChain({ session_id: 'agentic_session_1' });
    const finalChain = createUpdateChain({ session_id: 'agentic_session_1' });
    const supabase = createSupabaseWithUpdateChains([
      claimChain,
      markerChain,
      finalChain,
    ]);
    const storedClaim = `agentic_order_${'a'.repeat(64)}`;
    vi.mocked(createAgenticCheckoutOrder).mockResolvedValue({
      data: { order: { id: 'order-1' } },
      error: undefined,
      ok: true,
      orderId: 'order-1',
      status: 201,
      statusText: 'Created',
    });

    const response = await finalizeAgenticCheckoutPayment(
      finalizeInput(supabase, {
        expectedSessionUpdatedAt: '2026-07-20T11:30:00.000Z',
        finalizationClaimOverride: storedClaim,
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      order: { id: 'order-1' },
      status: 'ready_for_payment',
    });
    expect(supabase.update).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          agentic: expect.objectContaining({
            finalization_claim: storedClaim,
          }),
        }),
      })
    );
    expect(claimChain.eq).toHaveBeenCalledWith(
      'updated_at',
      '2026-07-20T11:30:00.000Z'
    );
    expect(finalChain.contains).toHaveBeenCalledWith('metadata', {
      agentic: {
        finalization_claim: storedClaim,
        payment_state: 'order_finalizing',
      },
    });
  });

  it.each([
    '',
    'agentic_order_invalid',
  ])('rejects invalid operator claim override %j before a session write', async (finalizationClaimOverride) => {
    const warnSpy = vi
      .spyOn(logger, 'warn')
      .mockImplementation(() => undefined);
    const claimChain = createUpdateChain(null);
    const supabase = createSupabaseWithUpdateChains([claimChain]);

    const response = await finalizeAgenticCheckoutPayment(
      finalizeInput(supabase, { finalizationClaimOverride })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid finalization claim',
    });
    expect(supabase.update).not.toHaveBeenCalled();
    expect(createAgenticCheckoutOrder).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith({
      message: 'Rejected invalid agentic finalization claim override',
      sessionId: 'agentic_session_1',
    });
    warnSpy.mockRestore();
  });

  it('requires an expected timestamp for an operator claim override', async () => {
    const claimChain = createUpdateChain(null);
    const supabase = createSupabaseWithUpdateChains([claimChain]);

    const response = await finalizeAgenticCheckoutPayment(
      finalizeInput(supabase, {
        finalizationClaimOverride: `agentic_order_${'a'.repeat(64)}`,
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Missing finalization timestamp',
    });
    expect(supabase.update).not.toHaveBeenCalled();
    expect(createAgenticCheckoutOrder).not.toHaveBeenCalled();
  });

  it('returns a database error when the finalization claim write fails', async () => {
    const claimChain = createUpdateChain(null, { message: 'claim failed' });
    const supabase = createSupabaseWithUpdateChains([claimChain]);

    const response = await finalizeAgenticCheckoutPayment(
      finalizeInput(supabase)
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Database error' });
    expect(createAgenticCheckoutOrder).not.toHaveBeenCalled();
    expect(revalidateProducts).not.toHaveBeenCalled();
    expect(revalidateProductSlugs).not.toHaveBeenCalled();
    expect(storeAgenticIdempotencyResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'idem-1',
        response: { error: 'Database error' },
        route: 'checkout_sessions.complete',
        status: 500,
      })
    );
    expect(sendAgenticOrderCreatedWebhook).not.toHaveBeenCalled();
  });

  it('does not expose internal order creation errors to agents', async () => {
    const claimChain = createUpdateChain({ session_id: 'agentic_session_1' });
    const releaseChain = createUpdateChain({ session_id: 'agentic_session_1' });
    const supabase = createSupabaseWithUpdateChains([claimChain, releaseChain]);
    vi.mocked(createAgenticCheckoutOrder).mockResolvedValue({
      data: {},
      error: 'database leaked payment gateway internals',
      ok: false,
      orderId: undefined,
      status: 500,
      statusText: 'Internal Server Error',
    });

    const response = await finalizeAgenticCheckoutPayment(
      finalizeInput(supabase)
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Order creation failed' });
    expect(body).not.toHaveProperty('details');
    expect(revalidateProducts).not.toHaveBeenCalled();
    expect(revalidateProductSlugs).not.toHaveBeenCalled();
  });

  it('cancels the created order and releases the claim when session finalization fails', async () => {
    const claimChain = createUpdateChain({ session_id: 'agentic_session_1' });
    const markerChain = createUpdateChain({ session_id: 'agentic_session_1' });
    const finalChain = createUpdateChain(null, { message: 'update failed' });
    const releaseChain = createUpdateChain({ session_id: 'agentic_session_1' });
    const supabase = createSupabaseWithUpdateChains([
      claimChain,
      markerChain,
      finalChain,
      releaseChain,
    ]);
    vi.mocked(createAgenticCheckoutOrder).mockResolvedValue({
      data: { order: { id: 'order-1' } },
      error: undefined,
      ok: true,
      orderId: 'order-1',
      status: 201,
      statusText: 'Created',
    });

    const response = await finalizeAgenticCheckoutPayment(
      finalizeInput(supabase)
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Database error' });
    // Stock was already decremented by the successful create_storefront_order
    // call above — the cache bust fires on creation, independent of whether
    // this later session-finalization step (and the resulting cancellation)
    // succeeds. A restock-on-cancel cache bust is a separate, unaddressed gap.
    expect(revalidateProducts).toHaveBeenCalledExactlyOnceWith(
      'merchant-1',
      undefined,
      { feedScope: 'merchant' }
    );
    expect(revalidateProductSlugs).toHaveBeenCalledTimes(2);
    expect(revalidateProductSlugs).toHaveBeenNthCalledWith(1, 'merchant-1', [
      'product-1-slug',
    ]);
    // The order-purge helper runs its merchant-independent local
    // invalidation (hard-expire) even though the slug lookup fails below.
    expect(revalidateProductSlugs).toHaveBeenNthCalledWith(
      2,
      'merchant-1',
      expect.any(Array),
      { expireImmediately: true }
    );
    expect(markAgenticCheckoutOrderCanceled).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: 'merchant-1',
        orderId: 'order-1',
        sessionId: 'agentic_session_1',
      })
    );
    expect(markerChain.contains).toHaveBeenCalledWith('metadata', {
      agentic: {
        finalization_claim: buildOrderFinalizationClaim({
          idempotencyKey: 'idem-1',
          requestId: 'req_123',
          sessionId: 'agentic_session_1',
        }),
        payment_state: 'order_finalizing',
      },
    });
    expect(releaseChain.contains).toHaveBeenCalledWith('metadata', {
      agentic: {
        finalization_claim: buildOrderFinalizationClaim({
          idempotencyKey: 'idem-1',
          requestId: 'req_123',
          sessionId: 'agentic_session_1',
        }),
        payment_state: 'order_finalizing',
      },
    });
    expect(storeAgenticIdempotencyResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'idem-1',
        response: { error: 'Database error' },
        route: 'checkout_sessions.complete',
        status: 500,
      })
    );
    expect(sendAgenticOrderCreatedWebhook).not.toHaveBeenCalled();
  });

  it('preserves the claim when order cancellation fails after session finalization failure', async () => {
    const claimChain = createUpdateChain({ session_id: 'agentic_session_1' });
    const markerChain = createUpdateChain({ session_id: 'agentic_session_1' });
    const finalChain = createUpdateChain(null, { message: 'update failed' });
    const releaseChain = createUpdateChain({ session_id: 'agentic_session_1' });
    const supabase = createSupabaseWithUpdateChains([
      claimChain,
      markerChain,
      finalChain,
      releaseChain,
    ]);
    vi.mocked(createAgenticCheckoutOrder).mockResolvedValue({
      data: { order: { id: 'order-1' } },
      error: undefined,
      ok: true,
      orderId: 'order-1',
      status: 201,
      statusText: 'Created',
    });
    vi.mocked(markAgenticCheckoutOrderCanceled).mockResolvedValueOnce({
      error: {
        code: 'TEST_ERROR',
        details: '',
        hint: '',
        message: 'cancellation failed',
        name: 'PostgrestError',
        toJSON: () => ({
          code: 'TEST_ERROR',
          details: '',
          hint: '',
          message: 'cancellation failed',
          name: 'PostgrestError',
        }),
      },
      updated: false,
    });

    const response = await finalizeAgenticCheckoutPayment(
      finalizeInput(supabase)
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Database error' });
    expect(revalidateProducts).toHaveBeenCalledExactlyOnceWith(
      'merchant-1',
      undefined,
      { feedScope: 'merchant' }
    );
    expect(revalidateProductSlugs).toHaveBeenCalledTimes(2);
    expect(revalidateProductSlugs).toHaveBeenNthCalledWith(1, 'merchant-1', [
      'product-1-slug',
    ]);
    // The order-purge helper runs its merchant-independent local
    // invalidation (hard-expire) even though the slug lookup fails below.
    expect(revalidateProductSlugs).toHaveBeenNthCalledWith(
      2,
      'merchant-1',
      expect.any(Array),
      { expireImmediately: true }
    );
    expect(markAgenticCheckoutOrderCanceled).toHaveBeenCalled();
    expect(releaseChain.contains).not.toHaveBeenCalled();
    expect(storeAgenticIdempotencyResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'idem-1',
        response: { error: 'Database error' },
        route: 'checkout_sessions.complete',
        status: 500,
      })
    );
    expect(sendAgenticOrderCreatedWebhook).not.toHaveBeenCalled();
  });

  it('guards final order persistence with an order_id null claim', async () => {
    const claimChain = createUpdateChain({ session_id: 'agentic_session_1' });
    const markerChain = createUpdateChain({ session_id: 'agentic_session_1' });
    const finalChain = createUpdateChain({ session_id: 'agentic_session_1' });
    const supabase = createSupabaseWithUpdateChains([
      claimChain,
      markerChain,
      finalChain,
    ]);
    vi.mocked(createAgenticCheckoutOrder).mockResolvedValue({
      data: { order: { id: 'order-1' } },
      error: undefined,
      ok: true,
      orderId: 'order-1',
      status: 201,
      statusText: 'Created',
    });
    const response = await finalizeAgenticCheckoutPayment(
      finalizeInput(supabase)
    );

    expect(response.status).toBe(200);
    expect(finalChain.is).toHaveBeenCalledWith('order_id', null);
    const expectedFinalizationClaim = buildOrderFinalizationClaim({
      idempotencyKey: 'idem-1',
      requestId: 'req_123',
      sessionId: 'agentic_session_1',
    });
    expect(finalChain.contains).toHaveBeenCalledWith('metadata', {
      agentic: {
        finalization_claim: expectedFinalizationClaim,
        payment_state: 'order_finalizing',
      },
    });
    expect(markAgenticCheckoutOrderCanceled).not.toHaveBeenCalled();
    expect(sendAgenticOrderCreatedWebhook).toHaveBeenCalled();
    expect(revalidateProducts).toHaveBeenCalledExactlyOnceWith(
      'merchant-1',
      undefined,
      { feedScope: 'merchant' }
    );
    expect(revalidateProductSlugs).toHaveBeenCalledTimes(2);
    expect(revalidateProductSlugs).toHaveBeenNthCalledWith(1, 'merchant-1', [
      'product-1-slug',
    ]);
    // The order-purge helper runs its merchant-independent local
    // invalidation (hard-expire) even though the slug lookup fails below.
    expect(revalidateProductSlugs).toHaveBeenNthCalledWith(
      2,
      'merchant-1',
      expect.any(Array),
      { expireImmediately: true }
    );
  });

  it('completes checkout when revalidateProducts throws (guarded, best-effort)', async () => {
    vi.mocked(revalidateProducts).mockImplementationOnce(() => {
      throw new Error('revalidate boom');
    });
    const claimChain = createUpdateChain({ session_id: 'agentic_session_1' });
    const markerChain = createUpdateChain({ session_id: 'agentic_session_1' });
    const finalChain = createUpdateChain({ session_id: 'agentic_session_1' });
    const supabase = createSupabaseWithUpdateChains([
      claimChain,
      markerChain,
      finalChain,
    ]);
    vi.mocked(createAgenticCheckoutOrder).mockResolvedValue({
      data: { order: { id: 'order-1' } },
      error: undefined,
      ok: true,
      orderId: 'order-1',
      status: 201,
      statusText: 'Created',
    });

    const response = await finalizeAgenticCheckoutPayment(
      finalizeInput(supabase)
    );

    expect(response.status).toBe(200);
    expect(revalidateProducts).toHaveBeenCalledExactlyOnceWith(
      'merchant-1',
      undefined,
      { feedScope: 'merchant' }
    );
    // revalidateProducts() threw synchronously, so the agentic layer's own
    // per-slug invalidation did not run — but the order-purge helper still
    // performs its merchant-independent local invalidation (hard-expire) on
    // both purge paths.
    expect(revalidateProductSlugs).toHaveBeenCalledTimes(2);
    expect(revalidateProductSlugs).toHaveBeenCalledWith(
      'merchant-1',
      expect.any(Array),
      { expireImmediately: true }
    );
  });

  it('revalidates the touched product slugs after a successful order', async () => {
    const claimChain = createUpdateChain({ session_id: 'agentic_session_1' });
    const markerChain = createUpdateChain({ session_id: 'agentic_session_1' });
    const finalChain = createUpdateChain({ session_id: 'agentic_session_1' });
    const productsChain = createProductsChain([
      { id: 'product-1', manage_stock: true, slug: 'phone-slug' },
    ]);
    const supabase = createSupabaseWithUpdateChains(
      [claimChain, markerChain, finalChain],
      productsChain
    );
    vi.mocked(createAgenticCheckoutOrder).mockResolvedValue({
      data: { order: { id: 'order-1' } },
      error: undefined,
      ok: true,
      orderId: 'order-1',
      status: 201,
      statusText: 'Created',
    });

    const response = await finalizeAgenticCheckoutPayment(
      finalizeInput(supabase)
    );

    expect(response.status).toBe(200);
    expect(productsChain.select).toHaveBeenCalledWith(
      'id, slug, manage_stock, inventory_tracking_policy'
    );
    expect(productsChain.in).toHaveBeenCalledWith('id', ['product-1']);
    expect(revalidateProductSlugs).toHaveBeenCalledTimes(2);
    expect(revalidateProductSlugs).toHaveBeenNthCalledWith(1, 'merchant-1', [
      'phone-slug',
    ]);
    // The order-purge helper runs its merchant-independent local
    // invalidation (hard-expire) even though the slug lookup fails below.
    expect(revalidateProductSlugs).toHaveBeenNthCalledWith(
      2,
      'merchant-1',
      expect.any(Array),
      { expireImmediately: true }
    );
  });

  it('logs and still completes checkout when the slug lookup fails', async () => {
    const claimChain = createUpdateChain({ session_id: 'agentic_session_1' });
    const markerChain = createUpdateChain({ session_id: 'agentic_session_1' });
    const finalChain = createUpdateChain({ session_id: 'agentic_session_1' });
    const productsChain = createProductsChain(null, { message: 'db down' });
    const supabase = createSupabaseWithUpdateChains(
      [claimChain, markerChain, finalChain],
      productsChain
    );
    vi.mocked(createAgenticCheckoutOrder).mockResolvedValue({
      data: { order: { id: 'order-1' } },
      error: undefined,
      ok: true,
      orderId: 'order-1',
      status: 201,
      statusText: 'Created',
    });

    const response = await finalizeAgenticCheckoutPayment(
      finalizeInput(supabase)
    );

    expect(response.status).toBe(200);
    expect(revalidateProducts).toHaveBeenCalledExactlyOnceWith(
      'merchant-1',
      undefined,
      { feedScope: 'merchant' }
    );
    // The agentic layer skips its own per-slug invalidation when the product
    // read fails, but the order-purge helper still runs its fail-open local
    // invalidation (hard-expire) for the committed order.
    expect(revalidateProductSlugs).toHaveBeenCalledTimes(1);
    expect(revalidateProductSlugs).toHaveBeenCalledWith(
      'merchant-1',
      expect.any(Array),
      { expireImmediately: true }
    );
  });

  it('skips the slug lookup entirely when there are no line items', async () => {
    const claimChain = createUpdateChain({ session_id: 'agentic_session_1' });
    const markerChain = createUpdateChain({ session_id: 'agentic_session_1' });
    const finalChain = createUpdateChain({ session_id: 'agentic_session_1' });
    const productsChain = createProductsChain([
      { manage_stock: true, slug: 'unused-slug' },
    ]);
    const supabase = createSupabaseWithUpdateChains(
      [claimChain, markerChain, finalChain],
      productsChain
    );
    vi.mocked(createAgenticCheckoutOrder).mockResolvedValue({
      data: { order: { id: 'order-1' } },
      error: undefined,
      ok: true,
      orderId: 'order-1',
      status: 201,
      statusText: 'Created',
    });

    const response = await finalizeAgenticCheckoutPayment(
      finalizeInput(supabase, {
        orderSessionCalc: { ...sessionCalc, lineItems: [] },
      })
    );

    expect(response.status).toBe(200);
    expect(productsChain.select).not.toHaveBeenCalled();
    expect(revalidateProducts).not.toHaveBeenCalled();
    expect(revalidateProductSlugs).not.toHaveBeenCalled();
  });

  it('does not churn product or feed caches for unlimited inventory', async () => {
    const claimChain = createUpdateChain({ session_id: 'agentic_session_1' });
    const markerChain = createUpdateChain({ session_id: 'agentic_session_1' });
    const finalChain = createUpdateChain({ session_id: 'agentic_session_1' });
    const productsChain = createProductsChain([
      {
        id: 'product-1',
        inventory_tracking_policy: 'off',
        manage_stock: false,
        slug: 'unlimited-phone',
      },
    ]);
    const supabase = createSupabaseWithUpdateChains(
      [claimChain, markerChain, finalChain],
      productsChain
    );
    vi.mocked(createAgenticCheckoutOrder).mockResolvedValue({
      data: { order: { id: 'order-1' } },
      error: undefined,
      ok: true,
      orderId: 'order-1',
      status: 201,
      statusText: 'Created',
    });

    const response = await finalizeAgenticCheckoutPayment(
      finalizeInput(supabase)
    );

    expect(response.status).toBe(200);
    expect(revalidateProducts).not.toHaveBeenCalled();
    expect(revalidateProductSlugs).not.toHaveBeenCalled();
    expect(revalidateDashboard).toHaveBeenCalledExactlyOnceWith('merchant-1');
  });

  it('forwards a complete shared-cart binding from metadata to dispatch', async () => {
    const claimChain = createUpdateChain({ session_id: 'agentic_session_1' });
    const markerChain = createUpdateChain({ session_id: 'agentic_session_1' });
    const finalChain = createUpdateChain({ session_id: 'agentic_session_1' });
    const supabase = createSupabaseWithUpdateChains([
      claimChain,
      markerChain,
      finalChain,
    ]);
    vi.mocked(createAgenticCheckoutOrder).mockResolvedValue({
      data: { order: { id: 'order-1' } },
      error: undefined,
      ok: true,
      orderId: 'order-1',
      status: 201,
      statusText: 'Created',
    });
    const sharedCart = {
      cart_id: '223e4567-e89b-12d3-a456-426614174000',
      cart_version: 3,
      checkout_generation: 1,
      checkout_session_id: '323e4567-e89b-12d3-a456-426614174000',
    };

    const response = await finalizeAgenticCheckoutPayment({
      ...finalizeInput(supabase),
      metadata: { agentic: { shared_cart: sharedCart } },
    });

    expect(response.status).toBe(200);
    expect(createAgenticCheckoutOrder).toHaveBeenCalledWith(
      expect.objectContaining({ shared_cart: sharedCart }),
      expect.anything(),
      { boundPrincipalId: null }
    );
  });

  it('forwards the resolved session principal to the bound dispatch', async () => {
    const claimChain = createUpdateChain({ session_id: 'agentic_session_1' });
    const markerChain = createUpdateChain({ session_id: 'agentic_session_1' });
    const finalChain = createUpdateChain({ session_id: 'agentic_session_1' });
    const supabase = createSupabaseWithUpdateChains([
      claimChain,
      markerChain,
      finalChain,
    ]);
    vi.mocked(createAgenticCheckoutOrder).mockResolvedValue({
      data: { order: { id: 'order-1' } },
      error: undefined,
      ok: true,
      orderId: 'order-1',
      status: 201,
      statusText: 'Created',
    });
    const sharedCart = {
      cart_id: '223e4567-e89b-12d3-a456-426614174000',
      cart_version: 3,
      checkout_generation: 1,
      checkout_session_id: '323e4567-e89b-12d3-a456-426614174000',
    };

    await finalizeAgenticCheckoutPayment({
      ...finalizeInput(supabase),
      metadata: { agentic: { shared_cart: sharedCart } },
      sharedCartPrincipalId: 'guest-principal-9',
    });

    expect(createAgenticCheckoutOrder).toHaveBeenCalledWith(
      expect.objectContaining({ shared_cart: sharedCart }),
      expect.anything(),
      { boundPrincipalId: 'guest-principal-9' }
    );
  });

  it('omits linkage-only shared-cart metadata from the order payload', async () => {
    const claimChain = createUpdateChain({ session_id: 'agentic_session_1' });
    const markerChain = createUpdateChain({ session_id: 'agentic_session_1' });
    const finalChain = createUpdateChain({ session_id: 'agentic_session_1' });
    const supabase = createSupabaseWithUpdateChains([
      claimChain,
      markerChain,
      finalChain,
    ]);
    vi.mocked(createAgenticCheckoutOrder).mockResolvedValue({
      data: { order: { id: 'order-1' } },
      error: undefined,
      ok: true,
      orderId: 'order-1',
      status: 201,
      statusText: 'Created',
    });

    await finalizeAgenticCheckoutPayment({
      ...finalizeInput(supabase),
      metadata: {
        agentic: {
          shared_cart: {
            cart_id: '223e4567-e89b-12d3-a456-426614174000',
          },
        },
      },
    });

    expect(createAgenticCheckoutOrder).toHaveBeenCalledWith(
      expect.not.objectContaining({ shared_cart: expect.anything() }),
      expect.anything(),
      { boundPrincipalId: null }
    );
  });

  it('propagates a binding conflict from dispatch instead of masking it', async () => {
    const claimChain = createUpdateChain({ session_id: 'agentic_session_1' });
    const releaseChain = createUpdateChain({ session_id: 'agentic_session_1' });
    const supabase = createSupabaseWithUpdateChains([claimChain, releaseChain]);
    vi.mocked(createAgenticCheckoutOrder).mockResolvedValue({
      data: { error: 'Shared cart changed during checkout; refresh and retry' },
      error: 'Shared cart changed during checkout; refresh and retry',
      ok: false,
      orderId: undefined,
      status: 409,
      statusText: 'Conflict',
    });

    const response = await finalizeAgenticCheckoutPayment(
      finalizeInput(supabase)
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      error: 'Shared cart changed during checkout; refresh and retry',
    });
    expect(storeAgenticIdempotencyResponse).toHaveBeenCalledWith(
      expect.objectContaining({ status: 409 })
    );
  });
  it.each([
    'marker',
    'session',
  ])('retains a bound order after %s failure and resumes the same receipt', async (failure) => {
    const row = () => createUpdateChain({ session_id: 'agentic_session_1' });
    const failed = () =>
      createUpdateChain(null, { message: 'database unavailable' });
    const supabase = createSupabaseWithUpdateChains(
      failure === 'marker'
        ? [row(), failed(), row(), row(), row(), row()]
        : [row(), row(), failed(), row(), row(), row(), row()]
    );
    vi.mocked(createAgenticCheckoutOrder).mockResolvedValue({
      ok: true,
      orderId: 'bound-order',
      status: 201,
      statusText: 'Created',
      data: { order: { id: 'bound-order' } },
      error: undefined,
    });
    const input = {
      ...finalizeInput(supabase),
      metadata: {
        agentic: {
          payment_state: 'payment_account_ready',
          shared_cart: {
            cart_id: '223e4567-e89b-12d3-a456-426614174000',
            cart_version: 3,
            checkout_generation: 1,
            checkout_session_id: '323e4567-e89b-12d3-a456-426614174000',
          },
        },
      },
    };
    const first = await finalizeAgenticCheckoutPayment(input);
    expect(first.status).toBe(500);
    expect(supabase.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          agentic: expect.objectContaining({
            payment_state: 'payment_account_ready',
          }),
        }),
      })
    );
    expect(markAgenticCheckoutOrderCanceled).not.toHaveBeenCalled();
    expect(sendAgenticOrderCreatedWebhook).not.toHaveBeenCalled();
    const retry = await finalizeAgenticCheckoutPayment({
      ...input,
      idempotencyKey: 'retry-key',
    });
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ order_id: 'bound-order' });
    expect(markAgenticCheckoutOrderCanceled).not.toHaveBeenCalled();
  });

  it('refuses payment instructions for a canceled bound receipt', async () => {
    const row = () => createUpdateChain({ session_id: 'agentic_session_1' });
    const supabase = createSupabaseWithUpdateChains([
      row(),
      row(),
      row(),
      row(),
      row(),
      row(),
    ]);
    const originalFrom = supabase.from.getMockImplementation();
    supabase.from.mockImplementation((table) => {
      if (table !== 'orders') return originalFrom?.(table) as never;
      const chain = {
        select: vi.fn(),
        eq: vi.fn(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { payment_status: 'cancelled', shipping_status: 'cancelled' },
          error: null,
        }),
      };
      chain.select.mockReturnValue(chain);
      chain.eq.mockReturnValue(chain);
      return chain as never;
    });
    vi.mocked(createAgenticCheckoutOrder).mockResolvedValue({
      ok: true,
      orderId: 'canceled-order',
      status: 201,
      statusText: 'Created',
      data: {},
      error: undefined,
    });
    const input = {
      ...finalizeInput(supabase),
      metadata: {
        agentic: {
          shared_cart: {
            cart_id: '223e4567-e89b-12d3-a456-426614174000',
            cart_version: 3,
            checkout_generation: 1,
            checkout_session_id: '323e4567-e89b-12d3-a456-426614174000',
          },
        },
      },
    };
    const response = await finalizeAgenticCheckoutPayment(input);
    expect(response.status).toBe(409);
    expect(await response.json()).not.toHaveProperty('payment_instructions');
    expect(sendAgenticOrderCreatedWebhook).not.toHaveBeenCalled();
    expect(supabase.update).toHaveBeenCalledTimes(3);
    const retry = await finalizeAgenticCheckoutPayment({
      ...input,
      idempotencyKey: 'canceled-retry',
    });
    expect(retry.status).toBe(409);
    expect(await retry.json()).toEqual({
      error: 'Order is no longer awaiting payment',
    });
    expect(supabase.update).toHaveBeenCalledTimes(6);
    expect(markAgenticCheckoutOrderCanceled).not.toHaveBeenCalled();
  });

  it.each([
    ['pending', null, 200],
    ['paid', null, 200],
    ['cancelled', null, 409],
    ['pending', { message: 'database unavailable' }, 500],
  ] as const)('checks live %s order state before resuming a saved bound marker', async (paymentStatus, error, status) => {
    const row = () => createUpdateChain({ session_id: 'agentic_session_1' });
    const supabase = createSupabaseWithUpdateChains([row(), row()]);
    const originalFrom = supabase.from.getMockImplementation();
    supabase.from.mockImplementation((table) => {
      if (table !== 'orders') return originalFrom?.(table) as never;
      const chain = {
        select: vi.fn(),
        eq: vi.fn(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { payment_status: paymentStatus, shipping_status: 'pending' },
          error,
        }),
      };
      chain.select.mockReturnValue(chain);
      chain.eq.mockReturnValue(chain);
      return chain as never;
    });
    const response = await finalizeAgenticCheckoutPayment({
      ...finalizeInput(supabase),
      metadata: {
        agentic: {
          finalization_order_id: 'bound-order',
          shared_cart: {
            cart_id: '223e4567-e89b-12d3-a456-426614174000',
            cart_version: 3,
            checkout_generation: 1,
            checkout_session_id: '323e4567-e89b-12d3-a456-426614174000',
          },
        },
      },
    });
    expect(response.status).toBe(status);
    expect(createAgenticCheckoutOrder).not.toHaveBeenCalled();
    expect(markAgenticCheckoutOrderCanceled).not.toHaveBeenCalled();
    expect(sendAgenticOrderCreatedWebhook).toHaveBeenCalledTimes(
      status === 200 && paymentStatus !== 'paid' ? 1 : 0
    );
    if (paymentStatus === 'paid') {
      expect(await response.json()).toEqual({
        id: 'agentic_session_1',
        status: 'completed',
        order_id: 'bound-order',
        order: { id: 'bound-order', status: 'paid' },
      });
      expect(supabase.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          status: 'completed',
          metadata: expect.objectContaining({
            agentic: expect.objectContaining({ payment_state: 'paid' }),
          }),
        })
      );
    }
  });

  it('answers already-paid when payment lands between verification and the session write', async () => {
    const chains = Array.from({ length: 5 }, () =>
      createUpdateChain({ session_id: 'agentic_session_1' })
    );
    const supabase = createSupabaseWithUpdateChains(chains);
    const originalFrom = supabase.from.getMockImplementation();
    let orderReads = 0;
    supabase.from.mockImplementation((table) => {
      if (table !== 'orders') return originalFrom?.(table) as never;
      const chain = {
        select: vi.fn(),
        eq: vi.fn(),
        maybeSingle: vi.fn().mockImplementation(async () => {
          orderReads += 1;
          return {
            data: {
              payment_status: orderReads === 1 ? 'pending' : 'paid',
              shipping_status: 'pending',
            },
            error: null,
          };
        }),
      };
      chain.select.mockReturnValue(chain);
      chain.eq.mockReturnValue(chain);
      return chain as never;
    });
    const response = await finalizeAgenticCheckoutPayment(
      finalizeInput(supabase)
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: 'agentic_session_1',
      status: 'completed',
      order_id: 'canceled-order',
      order: { id: 'canceled-order', status: 'paid' },
    });
    expect(sendAgenticOrderCreatedWebhook).not.toHaveBeenCalled();
  });

  it('reconciles the session when cancellation lands between verification and the session write', async () => {
    const chains = Array.from({ length: 5 }, () =>
      createUpdateChain({ session_id: 'agentic_session_1' })
    );
    const supabase = createSupabaseWithUpdateChains(chains);
    const originalFrom = supabase.from.getMockImplementation();
    let orderReads = 0;
    supabase.from.mockImplementation((table) => {
      if (table !== 'orders') return originalFrom?.(table) as never;
      const chain = {
        select: vi.fn(),
        eq: vi.fn(),
        maybeSingle: vi.fn().mockImplementation(async () => {
          orderReads += 1;
          return {
            data: {
              payment_status: 'pending',
              shipping_status: orderReads === 1 ? 'pending' : 'cancelled',
            },
            error: null,
          };
        }),
      };
      chain.select.mockReturnValue(chain);
      chain.eq.mockReturnValue(chain);
      return chain as never;
    });
    const response = await finalizeAgenticCheckoutPayment(
      finalizeInput(supabase)
    );
    expect(response.status).toBe(409);
    expect(sendAgenticOrderCreatedWebhook).not.toHaveBeenCalled();
    const updates = (
      supabase as unknown as {
        update: { mock: { calls: [Record<string, unknown>][] } };
      }
    ).update.mock.calls.map(([payload]) => JSON.stringify(payload));
    expect(
      updates.some((payload) => payload.includes('payment_setup_failed'))
    ).toBe(true);
  });

  it('fails closed when the post-write order revalidation cannot read', async () => {
    const chains = Array.from({ length: 4 }, () =>
      createUpdateChain({ session_id: 'agentic_session_1' })
    );
    const supabase = createSupabaseWithUpdateChains(chains);
    const originalFrom = supabase.from.getMockImplementation();
    let orderReads = 0;
    supabase.from.mockImplementation((table) => {
      if (table !== 'orders') return originalFrom?.(table) as never;
      const chain = {
        select: vi.fn(),
        eq: vi.fn(),
        maybeSingle: vi.fn().mockImplementation(async () => {
          orderReads += 1;
          return orderReads === 1
            ? {
                data: { payment_status: 'pending', shipping_status: 'pending' },
                error: null,
              }
            : { data: null, error: { message: 'connection reset' } };
        }),
      };
      chain.select.mockReturnValue(chain);
      chain.eq.mockReturnValue(chain);
      return chain as never;
    });
    const response = await finalizeAgenticCheckoutPayment(
      finalizeInput(supabase)
    );
    expect(response.status).toBe(503);
    expect(sendAgenticOrderCreatedWebhook).not.toHaveBeenCalled();
    // The session is fenced out of payment_pending before the 503
    // so a later request cannot serve the stored instructions.
    const updates = (
      supabase as unknown as {
        update: { mock: { calls: [Record<string, unknown>][] } };
      }
    ).update.mock.calls.map(([payload]) => JSON.stringify(payload));
    expect(
      updates.some((payload) => payload.includes('payment_setup_failed'))
    ).toBe(true);
  });

  it.each([
    ['write error', { message: 'write failed' }],
    ['zero-row match', null],
  ] as const)('does not store the conflict when cancellation reconciliation fails (%s)', async (_label, error) => {
    const chains = [
      createUpdateChain({ session_id: 'agentic_session_1' }),
      createUpdateChain({ session_id: 'agentic_session_1' }),
      createUpdateChain({ session_id: 'agentic_session_1' }),
      createUpdateChain(null, error),
    ];
    const supabase = createSupabaseWithUpdateChains(chains);
    const originalFrom = supabase.from.getMockImplementation();
    let orderReads = 0;
    supabase.from.mockImplementation((table) => {
      if (table !== 'orders') return originalFrom?.(table) as never;
      const chain = {
        select: vi.fn(),
        eq: vi.fn(),
        maybeSingle: vi.fn().mockImplementation(async () => {
          orderReads += 1;
          return {
            data: {
              payment_status: 'pending',
              shipping_status: orderReads === 1 ? 'pending' : 'cancelled',
            },
            error: null,
          };
        }),
      };
      chain.select.mockReturnValue(chain);
      chain.eq.mockReturnValue(chain);
      return chain as never;
    });
    const response = await finalizeAgenticCheckoutPayment(
      finalizeInput(supabase)
    );
    expect(response.status).toBe(500);
    expect(sendAgenticOrderCreatedWebhook).not.toHaveBeenCalled();
  });

  it('does not claim paid when the reconciliation write fails', async () => {
    const chains = [
      createUpdateChain({ session_id: 'agentic_session_1' }),
      createUpdateChain({ session_id: 'agentic_session_1' }),
      createUpdateChain({ session_id: 'agentic_session_1' }),
      createUpdateChain(null, { message: 'write failed' }),
    ];
    const supabase = createSupabaseWithUpdateChains(chains);
    const originalFrom = supabase.from.getMockImplementation();
    let orderReads = 0;
    supabase.from.mockImplementation((table) => {
      if (table !== 'orders') return originalFrom?.(table) as never;
      const chain = {
        select: vi.fn(),
        eq: vi.fn(),
        maybeSingle: vi.fn().mockImplementation(async () => {
          orderReads += 1;
          return {
            data: {
              payment_status: orderReads === 1 ? 'pending' : 'paid',
              shipping_status: 'pending',
            },
            error: null,
          };
        }),
      };
      chain.select.mockReturnValue(chain);
      chain.eq.mockReturnValue(chain);
      return chain as never;
    });
    const response = await finalizeAgenticCheckoutPayment(
      finalizeInput(supabase)
    );
    expect(response.status).toBe(500);
    expect(sendAgenticOrderCreatedWebhook).not.toHaveBeenCalled();
  });

  it('does not claim paid when the reconciliation write matches no row', async () => {
    const chains = [
      createUpdateChain({ session_id: 'agentic_session_1' }),
      createUpdateChain({ session_id: 'agentic_session_1' }),
      createUpdateChain({ session_id: 'agentic_session_1' }),
      createUpdateChain(null),
    ];
    const supabase = createSupabaseWithUpdateChains(chains);
    const originalFrom = supabase.from.getMockImplementation();
    let orderReads = 0;
    supabase.from.mockImplementation((table) => {
      if (table !== 'orders') return originalFrom?.(table) as never;
      const chain = {
        select: vi.fn(),
        eq: vi.fn(),
        maybeSingle: vi.fn().mockImplementation(async () => {
          orderReads += 1;
          return {
            data: {
              payment_status: orderReads === 1 ? 'pending' : 'paid',
              shipping_status: 'pending',
            },
            error: null,
          };
        }),
      };
      chain.select.mockReturnValue(chain);
      chain.eq.mockReturnValue(chain);
      return chain as never;
    });
    const response = await finalizeAgenticCheckoutPayment(
      finalizeInput(supabase)
    );
    expect(response.status).toBe(500);
    expect(sendAgenticOrderCreatedWebhook).not.toHaveBeenCalled();
  });

  it.each([
    ['paid', 200],
    ['cancelled', 409],
  ] as const)('checks live %s order state before resuming a saved unbound marker', async (paymentStatus, status) => {
    const row = () => createUpdateChain({ session_id: 'agentic_session_1' });
    const supabase = createSupabaseWithUpdateChains([row(), row()]);
    const originalFrom = supabase.from.getMockImplementation();
    supabase.from.mockImplementation((table) => {
      if (table !== 'orders') return originalFrom?.(table) as never;
      const chain = {
        select: vi.fn(),
        eq: vi.fn(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { payment_status: paymentStatus, shipping_status: 'pending' },
          error: null,
        }),
      };
      chain.select.mockReturnValue(chain);
      chain.eq.mockReturnValue(chain);
      return chain as never;
    });
    const response = await finalizeAgenticCheckoutPayment({
      ...finalizeInput(supabase),
      metadata: {
        agentic: { finalization_order_id: 'unbound-order' },
      },
    });
    expect(response.status).toBe(status);
    expect(createAgenticCheckoutOrder).not.toHaveBeenCalled();
    expect(sendAgenticOrderCreatedWebhook).not.toHaveBeenCalled();
    if (paymentStatus === 'paid') {
      expect(await response.json()).toEqual({
        id: 'agentic_session_1',
        status: 'completed',
        order_id: 'unbound-order',
        order: { id: 'unbound-order', status: 'paid' },
      });
    }
  });
});
