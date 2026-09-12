import { beforeEach, describe, expect, it, vi } from 'vitest';
import { finalizeAgenticPayOnDeliveryCheckout } from '@/lib/agentic/checkout-pay-on-delivery-finalize';

const mocks = vi.hoisted(() => ({
  buildOrderFinalizationClaim: vi.fn(() => 'claim-1'),
  revalidateDashboard: vi.fn(),
  revalidateProducts: vi.fn(),
  revalidateProductSlugs: vi.fn(),
  buildPayOnDeliveryCheckoutResponse: vi.fn(() => ({ ok: true })),
  buildPayOnDeliveryCompletedSessionUpdate: vi.fn(() => ({
    metadata: {},
    order_id: 'order-1',
  })),
  buildPayOnDeliveryOrderPayload: vi.fn(() => ({ payload: true })),
  buildPersistedAgenticIdempotencyResponse: vi.fn(
    ({ response, status }: { response: unknown; status: number }) => ({
      body: response,
      status,
    })
  ),
  buildStoredAgenticIdempotencyResponse: vi.fn(
    ({ response, status }: { response: unknown; status: number }) => ({
      body: response,
      status,
    })
  ),
  claimPayOnDeliveryFinalization: vi.fn(),
  compensatePayOnDeliveryFinalizationFailure: vi.fn(),
  createAgenticCheckoutOrder: vi.fn(),
  getMarkedPayOnDeliveryFinalizationOrderId: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
  persistAgenticIdempotencyResponse: vi.fn(),
  recordPayOnDeliveryOrderCreated: vi.fn(),
  releasePayOnDeliveryClaimSafely: vi.fn(),
  sendAgenticOrderCreatedWebhook: vi.fn(),
}));

vi.mock('@/lib/agentic/checkout-order-dispatch', () => ({
  createAgenticCheckoutOrder: mocks.createAgenticCheckoutOrder,
  sendAgenticOrderCreatedWebhook: mocks.sendAgenticOrderCreatedWebhook,
}));

vi.mock('@/lib/product-cache-revalidation', () => ({
  productCacheRevalidation: {
    revalidateDashboard: mocks.revalidateDashboard,
    revalidateProductSlugs: mocks.revalidateProductSlugs,
    revalidateProducts: mocks.revalidateProducts,
  },
}));

vi.mock('@/lib/agentic/checkout-order-finalization-claim', () => ({
  buildOrderFinalizationClaim: mocks.buildOrderFinalizationClaim,
}));

vi.mock('@/lib/agentic/checkout-pay-on-delivery-claim', () => ({
  claimPayOnDeliveryFinalization: mocks.claimPayOnDeliveryFinalization,
  getMarkedPayOnDeliveryFinalizationOrderId:
    mocks.getMarkedPayOnDeliveryFinalizationOrderId,
  recordPayOnDeliveryOrderCreated: mocks.recordPayOnDeliveryOrderCreated,
}));

vi.mock('@/lib/agentic/checkout-pay-on-delivery-compensation', () => ({
  compensatePayOnDeliveryFinalizationFailure:
    mocks.compensatePayOnDeliveryFinalizationFailure,
  releasePayOnDeliveryClaimSafely: mocks.releasePayOnDeliveryClaimSafely,
}));

vi.mock('@/lib/agentic/checkout-pay-on-delivery-payloads', () => ({
  buildPayOnDeliveryCheckoutResponse: mocks.buildPayOnDeliveryCheckoutResponse,
  buildPayOnDeliveryCompletedSessionUpdate:
    mocks.buildPayOnDeliveryCompletedSessionUpdate,
  buildPayOnDeliveryOrderPayload: mocks.buildPayOnDeliveryOrderPayload,
  PAY_ON_DELIVERY_METHOD: 'pay_on_delivery',
}));

vi.mock('@/lib/agentic/idempotency-response-storage', () => ({
  buildPersistedAgenticIdempotencyResponse:
    mocks.buildPersistedAgenticIdempotencyResponse,
  buildStoredAgenticIdempotencyResponse:
    mocks.buildStoredAgenticIdempotencyResponse,
  persistAgenticIdempotencyResponse: mocks.persistAgenticIdempotencyResponse,
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: mocks.loggerError, warn: mocks.loggerWarn },
}));

const buyer = {
  email: 'buyer@example.com',
  first_name: 'Ada',
  last_name: 'Lovelace',
  phone_number: '+2348012345678',
};

const metadata = { agentic: { existing: true } };

const orderSession = {
  currency: 'NGN',
  merchant_id: 'merchant-1',
  session_id: 'agentic_session_1',
  shipping_address: { city: 'Lagos' },
};

const orderSessionCalc = {
  lineItems: [],
  totals: [{ type: 'total', amount: 500000 }],
} as unknown as Parameters<
  typeof finalizeAgenticPayOnDeliveryCheckout
>[0]['orderSessionCalc'];

const trackedOrderSessionCalc = {
  lineItems: [
    {
      id: 'line_product-1',
      item: { id: 'product-1', product_id: 'product-1', quantity: 1 },
      base_amount: 500000,
      discount: 0,
      subtotal: 500000,
      tax: 0,
      total: 500000,
    },
  ],
  totals: [{ type: 'total', amount: 500000, display_text: 'Total' }],
  fulfillmentOptions: [],
  selectedOptionId: undefined,
  messages: [],
} as Parameters<
  typeof finalizeAgenticPayOnDeliveryCheckout
>[0]['orderSessionCalc'];

function buildSessionUpdateMock(result: unknown) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const chain = {
    contains: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    maybeSingle,
    select: vi.fn(),
    update: vi.fn(),
  };
  chain.update.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.is.mockReturnValue(chain);
  chain.contains.mockReturnValue(chain);
  chain.select.mockReturnValue(chain);
  return {
    chain,
    supabase: { from: vi.fn().mockReturnValue(chain) },
  };
}

function createProductsChain(
  data: Array<{
    id?: string;
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

function createCheckoutSupabase(
  mock: ReturnType<typeof buildSessionUpdateMock>,
  productsChain: ReturnType<typeof createProductsChain>
) {
  const variantsChain = createVariantsChain();
  return {
    from: vi.fn((table: string) =>
      table === 'products'
        ? productsChain
        : table === 'product_variants'
          ? variantsChain
          : mock.chain
    ),
  };
}

function callFinalize(
  supabase: unknown,
  orderSessionCalcOverride?: typeof orderSessionCalc
) {
  return finalizeAgenticPayOnDeliveryCheckout({
    buyer,
    idempotencyKey: 'idem-1',
    merchantId: 'merchant-1',
    metadata,
    orderSession,
    orderSessionCalc: orderSessionCalcOverride ?? orderSessionCalc,
    requestId: 'req-1',
    route: '/api/agentic/checkout_sessions/x/complete',
    sessionId: 'agentic_session_1',
    supabase: supabase as never,
  });
}

describe('finalizeAgenticPayOnDeliveryCheckout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getMarkedPayOnDeliveryFinalizationOrderId.mockReturnValue(null);
    mocks.claimPayOnDeliveryFinalization.mockResolvedValue({
      claimed: true,
      error: null,
    });
    mocks.recordPayOnDeliveryOrderCreated.mockResolvedValue({
      error: null,
      recorded: true,
    });
    mocks.createAgenticCheckoutOrder.mockResolvedValue({
      ok: true,
      orderId: 'order-1',
    });
    mocks.persistAgenticIdempotencyResponse.mockResolvedValue({ ok: true });
  });

  it('returns 500 when the claim helper reports an error', async () => {
    mocks.claimPayOnDeliveryFinalization.mockResolvedValue({
      claimed: false,
      error: { message: 'db error' },
    });
    const supabase = buildSessionUpdateMock({
      data: { session_id: 'x' },
      error: null,
    }).supabase;

    const result = await callFinalize(supabase);

    expect(result).toEqual({ body: { error: 'Database error' }, status: 500 });
    expect(mocks.createAgenticCheckoutOrder).not.toHaveBeenCalled();
    expect(mocks.sendAgenticOrderCreatedWebhook).not.toHaveBeenCalled();
    expect(mocks.revalidateProducts).not.toHaveBeenCalled();
  });

  it('returns 409 when the claim is not granted (already in progress)', async () => {
    mocks.claimPayOnDeliveryFinalization.mockResolvedValue({
      claimed: false,
      error: null,
    });
    const supabase = buildSessionUpdateMock({
      data: { session_id: 'x' },
      error: null,
    }).supabase;

    const result = await callFinalize(supabase);

    expect(result).toEqual({
      body: {
        error: 'Session finalization already in progress',
        status: 'payment_pending',
      },
      status: 409,
    });
    expect(mocks.createAgenticCheckoutOrder).not.toHaveBeenCalled();
    expect(mocks.revalidateProducts).not.toHaveBeenCalled();
  });

  it('happy path: creates order, marks it, updates session, dispatches webhook', async () => {
    const mock = buildSessionUpdateMock({
      data: { session_id: 'agentic_session_1' },
      error: null,
    });

    const result = await callFinalize(mock.supabase);

    expect(result).toMatchObject({ status: 200 });
    expect(mocks.createAgenticCheckoutOrder).toHaveBeenCalledTimes(1);
    expect(mocks.recordPayOnDeliveryOrderCreated).toHaveBeenCalledTimes(1);
    expect(mocks.sendAgenticOrderCreatedWebhook).toHaveBeenCalledTimes(1);
    expect(
      mocks.compensatePayOnDeliveryFinalizationFailure
    ).not.toHaveBeenCalled();
    expect(mocks.releasePayOnDeliveryClaimSafely).not.toHaveBeenCalled();
    expect(mocks.revalidateProducts).not.toHaveBeenCalled();
    // The shared orderSessionCalc fixture has no line items, so there is
    // nothing to resolve slugs for.
    expect(mocks.revalidateProductSlugs).not.toHaveBeenCalled();
  });

  it('returns 500 and releases the claim when createAgenticCheckoutOrder throws', async () => {
    mocks.createAgenticCheckoutOrder.mockRejectedValue(new Error('boom'));
    const supabase = buildSessionUpdateMock({
      data: { session_id: 'x' },
      error: null,
    }).supabase;

    const result = await callFinalize(supabase);

    expect(result).toEqual({
      body: { error: 'Order creation failed' },
      status: 500,
    });
    expect(mocks.releasePayOnDeliveryClaimSafely).toHaveBeenCalledTimes(1);
    expect(mocks.sendAgenticOrderCreatedWebhook).not.toHaveBeenCalled();
    expect(mocks.revalidateProducts).not.toHaveBeenCalled();
  });

  it('returns 500 and releases the claim when createAgenticCheckoutOrder returns ok=false', async () => {
    mocks.createAgenticCheckoutOrder.mockResolvedValue({
      ok: false,
      error: 'rejected',
      statusText: 'Bad Request',
    });
    const supabase = buildSessionUpdateMock({
      data: { session_id: 'x' },
      error: null,
    }).supabase;

    const result = await callFinalize(supabase);

    expect(result).toEqual({
      body: { error: 'Order creation failed' },
      status: 500,
    });
    expect(mocks.releasePayOnDeliveryClaimSafely).toHaveBeenCalledTimes(1);
    expect(mocks.sendAgenticOrderCreatedWebhook).not.toHaveBeenCalled();
    expect(mocks.revalidateProducts).not.toHaveBeenCalled();
  });

  it('returns 500 and releases the claim when createAgenticCheckoutOrder is missing orderId', async () => {
    mocks.createAgenticCheckoutOrder.mockResolvedValue({
      ok: true,
      orderId: undefined,
    });
    const supabase = buildSessionUpdateMock({
      data: { session_id: 'x' },
      error: null,
    }).supabase;

    const result = await callFinalize(supabase);

    expect(result).toEqual({
      body: { error: 'Order creation failed' },
      status: 500,
    });
    expect(mocks.releasePayOnDeliveryClaimSafely).toHaveBeenCalledTimes(1);
    expect(mocks.sendAgenticOrderCreatedWebhook).not.toHaveBeenCalled();
    expect(mocks.revalidateProducts).not.toHaveBeenCalled();
  });

  it('compensates and returns 500 when recordPayOnDeliveryOrderCreated reports recorded:false', async () => {
    mocks.recordPayOnDeliveryOrderCreated.mockResolvedValue({
      error: { message: 'no row' },
      recorded: false,
    });
    const supabase = buildSessionUpdateMock({
      data: { session_id: 'x' },
      error: null,
    }).supabase;

    const result = await callFinalize(supabase);

    expect(result).toEqual({ body: { error: 'Database error' }, status: 500 });
    expect(
      mocks.compensatePayOnDeliveryFinalizationFailure
    ).toHaveBeenCalledTimes(1);
    expect(
      mocks.compensatePayOnDeliveryFinalizationFailure
    ).toHaveBeenCalledWith(
      expect.objectContaining({ orderError: { message: 'no row' } })
    );
    expect(mocks.sendAgenticOrderCreatedWebhook).not.toHaveBeenCalled();
    // The order was genuinely created (stock already decremented) before the
    // marker write failed — revalidation already fired and stays fired.
    expect(mocks.revalidateProducts).not.toHaveBeenCalled();
    expect(mocks.revalidateProductSlugs).not.toHaveBeenCalled();
  });

  it('completes checkout when revalidateProducts throws (guarded, best-effort)', async () => {
    mocks.revalidateProducts.mockImplementationOnce(() => {
      throw new Error('revalidate boom');
    });
    const mock = buildSessionUpdateMock({
      data: { session_id: 'agentic_session_1' },
      error: null,
    });
    const productsChain = createProductsChain([
      { id: 'product-1', manage_stock: true, slug: 'phone-slug' },
    ]);
    const supabase = createCheckoutSupabase(mock, productsChain);

    const result = await callFinalize(supabase, trackedOrderSessionCalc);

    expect(result).toMatchObject({ status: 200 });
    expect(mocks.sendAgenticOrderCreatedWebhook).toHaveBeenCalledTimes(1);
  });

  it('revalidates the touched product slugs after a successful order', async () => {
    const mock = buildSessionUpdateMock({
      data: { session_id: 'agentic_session_1' },
      error: null,
    });
    const productsChain = createProductsChain([
      { manage_stock: true, slug: 'phone-slug' },
    ]);
    const supabase = createCheckoutSupabase(mock, productsChain);

    const result = await callFinalize(supabase, trackedOrderSessionCalc);

    expect(result).toMatchObject({ status: 200 });
    expect(mocks.revalidateProducts).toHaveBeenCalledExactlyOnceWith(
      'merchant-1',
      undefined,
      { feedScope: 'merchant' }
    );
    expect(productsChain.select).toHaveBeenCalledWith(
      'id, slug, manage_stock, inventory_tracking_policy'
    );
    expect(productsChain.in).toHaveBeenCalledWith('id', ['product-1']);
    expect(mocks.revalidateProductSlugs).toHaveBeenCalledExactlyOnceWith(
      'merchant-1',
      ['phone-slug']
    );
  });

  it('logs and still completes checkout when the slug lookup fails', async () => {
    const mock = buildSessionUpdateMock({
      data: { session_id: 'agentic_session_1' },
      error: null,
    });
    const productsChain = createProductsChain(null, { message: 'db down' });
    const supabase = createCheckoutSupabase(mock, productsChain);

    const result = await callFinalize(supabase, trackedOrderSessionCalc);

    expect(result).toMatchObject({ status: 200 });
    expect(mocks.revalidateProducts).toHaveBeenCalledExactlyOnceWith(
      'merchant-1',
      undefined,
      { feedScope: 'merchant' }
    );
    expect(mocks.revalidateProductSlugs).not.toHaveBeenCalled();
  });

  it('does not churn product or feed caches for unlimited inventory', async () => {
    const mock = buildSessionUpdateMock({
      data: { session_id: 'agentic_session_1' },
      error: null,
    });
    const productsChain = createProductsChain([
      { id: 'product-1', manage_stock: false, slug: 'unlimited-phone' },
    ]);
    const supabase = createCheckoutSupabase(mock, productsChain);

    const result = await callFinalize(supabase, trackedOrderSessionCalc);

    expect(result).toMatchObject({ status: 200 });
    expect(mocks.revalidateProducts).not.toHaveBeenCalled();
    expect(mocks.revalidateProductSlugs).not.toHaveBeenCalled();
    expect(mocks.revalidateDashboard).toHaveBeenCalledExactlyOnceWith(
      'merchant-1'
    );
  });
});
