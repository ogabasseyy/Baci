import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  authenticateApiRequest,
  NextRequest,
  POST,
} from './route.order-test-mocks.test-support';
import {
  baseOrderPayload,
  buildPilotMockSupabase,
  mockAuthUser,
  primeAdminOrderCurrencyRead,
} from './route.redvault-pilot-fixtures.test-support';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/orders REDVAULT integration', () => {
  async function runPilotOrder(
    validationResult: boolean,
    availabilityReason:
      | 'private_live_pilot'
      | 'staging_test_mode' = 'private_live_pilot',
    lineVatRateBp = 0,
    merchantVatRegistrationStatus: string | null = null,
    overrides: {
      body?: Record<string, unknown>;
      shippingVerification?: { amount: number; kind: 'ship' | 'pickup' };
    } = {}
  ) {
    vi.clearAllMocks();
    vi.stubEnv('REDVAULT_LIVE_PILOT_ENABLED', 'true');
    vi.stubEnv('BACI_RUNTIME_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv(
      'REDVAULT_LIVE_PILOT_SUPABASE_URL',
      'https://redvault-pilot-test.supabase.co'
    );
    vi.stubEnv(
      'NEXT_PUBLIC_SUPABASE_URL',
      'https://redvault-pilot-test.supabase.co'
    );
    vi.stubEnv(
      'REDVAULT_LIVE_PILOT_MERCHANT_ID',
      '6b5cb8a4-5575-456c-b936-8cdfae30db74'
    );
    vi.stubEnv(
      'REDVAULT_LIVE_PILOT_PRODUCT_ID',
      '11111111-1111-4111-8111-111111111111'
    );
    vi.stubEnv('REDVAULT_LIVE_PILOT_EXPIRES_AT', '2030-01-01T00:00:00.000Z');
    vi.stubEnv('REDVAULT_LIVE_PILOT_MAX_ATTEMPTS', '1');
    vi.stubEnv('REDVAULT_LIVE_PROVIDER_EVIDENCE', 'confirmed');
    vi.stubEnv('PAYSTACK_SECRET_KEY', 'sk_live_route_test_fixture');
    primeAdminOrderCurrencyRead();

    const availability = await import(
      '@/lib/checkout/redvault-payment-availability'
    );
    const quoting = await import('@/lib/checkout/compute-redvault-order-quote');
    const checkout = await import(
      '@/lib/checkout/create-redvault-checkout-response'
    );
    const { redvaultTestQuote } = await import(
      '@/lib/checkout/redvault-test-fixture'
    );
    const { REDVAULT_PILOT_USER_ID } = await import(
      '@/lib/checkout/redvault-live-pilot'
    );
    const availabilitySpy = vi
      .spyOn(availability, 'getRedvaultPaymentAvailability')
      .mockReturnValue({ available: true, reason: availabilityReason });
    const pilotQuote = {
      ...redvaultTestQuote,
      discountKobo: 500,
      lines: redvaultTestQuote.lines.map((line) => ({
        ...line,
        discountKobo: 500,
        unitDiscountsKobo: [500],
        vatRateBp: lineVatRateBp,
      })),
      groups: redvaultTestQuote.groups.map((group) => ({
        ...group,
        discountKobo: 500,
        members: group.members.map((member) => ({
          ...member,
          allocationKobo: 500,
        })),
      })),
    };
    const quoteSpy = vi
      .spyOn(quoting, 'computeRedvaultOrderQuote')
      .mockResolvedValue(pilotQuote);
    const checkoutSpy = vi
      .spyOn(checkout, 'createRedvaultCheckoutResponse')
      .mockResolvedValue(
        Response.json(
          { order: { id: 'protected-pilot-order' } },
          { status: 201 }
        ) as never
      );
    const supabase = buildPilotMockSupabase({
      merchantVatRegistrationStatus,
      productRows: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Galaxy S24',
          price: 100,
          slug: 'galaxy-s24',
          vat_category_code: 'S',
          vat_rate: 7.5,
        },
      ],
    });
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: mockAuthUser(
        validationResult ? REDVAULT_PILOT_USER_ID : 'other-user'
      ),
      error: null,
      supabase: supabase as never,
    });
    const shippingSpy = overrides.shippingVerification
      ? vi
          .spyOn(
            await import(
              '@/lib/shipping/merchant-rates/verify-order-shipping-rate'
            ),
            'verifyOrderShippingRate'
          )
          .mockResolvedValue({
            ok: true,
            amount: overrides.shippingVerification.amount,
            currency: 'NGN',
            kind: overrides.shippingVerification.kind,
            rateName: 'Verified rate',
            pickupAddress: null,
          } as never)
      : null;

    try {
      const response = await POST(
        new NextRequest('http://localhost/api/orders', {
          method: 'POST',
          headers: { 'Idempotency-Key': 'redvault-live-pilot-order' },
          body: JSON.stringify({
            ...baseOrderPayload,
            merchant_id: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
            items: [
              {
                product_id: '11111111-1111-4111-8111-111111111111',
                name: 'Galaxy S24',
                price: 100,
                quantity: 1,
              },
            ],
            subtotal: 100,
            payment_method: 'uba_redvault',
            ...overrides.body,
          }),
        })
      );
      return {
        checkoutCalled: checkoutSpy.mock.calls.length > 0,
        createDraftRpcCalled: supabase.rpc.mock.calls.some(
          ([name]) => name === 'create_storefront_redvault_order'
        ),
        genericOrderRpcCalled: supabase.rpc.mock.calls.some(
          ([name]) => name === 'create_storefront_order'
        ),
        response,
      };
    } finally {
      availabilitySpy.mockRestore();
      quoteSpy.mockRestore();
      checkoutSpy.mockRestore();
      shippingSpy?.mockRestore();
    }
  }

  it('returns 409 before creating an order when pilot validation denies the order', async () => {
    const result = await runPilotOrder(false);

    expect(result.response.status).toBe(409);
    expect(await result.response.json()).toMatchObject({
      code: 'REDVAULT_PILOT_UNAVAILABLE',
    });
    expect(result.checkoutCalled).toBe(false);
    expect(result.createDraftRpcCalled).toBe(false);
    expect(result.genericOrderRpcCalled).toBe(false);
  });

  it('continues to protected REDVAULT checkout when pilot validation allows the zero-rate order', async () => {
    const result = await runPilotOrder(true);

    expect(result.response.status).toBe(201);
    await expect(result.response.json()).resolves.toEqual({
      order: { id: 'protected-pilot-order' },
    });
    expect(result.checkoutCalled).toBe(true);
    expect(result.createDraftRpcCalled).toBe(false);
    expect(result.genericOrderRpcCalled).toBe(false);
  });

  it('skips live-pilot validation for staging test mode even when the pilot flag is set', async () => {
    const result = await runPilotOrder(false, 'staging_test_mode');

    expect(result.response.status).toBe(201);
    await expect(result.response.json()).resolves.toEqual({
      order: { id: 'protected-pilot-order' },
    });
    expect(result.checkoutCalled).toBe(true);
    expect(result.createDraftRpcCalled).toBe(false);
    expect(result.genericOrderRpcCalled).toBe(false);
  });

  it('accepts a taxed pilot basket when the quote VAT rate matches the computed order tax', async () => {
    const result = await runPilotOrder(
      true,
      'private_live_pilot',
      750,
      'registered'
    );

    expect(result.response.status).toBe(201);
    await expect(result.response.json()).resolves.toEqual({
      order: { id: 'protected-pilot-order' },
    });
    expect(result.checkoutCalled).toBe(true);
    expect(result.createDraftRpcCalled).toBe(false);
    expect(result.genericOrderRpcCalled).toBe(false);
  });

  it('returns 409 when the quote VAT rate disagrees with the computed order tax', async () => {
    const result = await runPilotOrder(true, 'private_live_pilot', 750);

    expect(result.response.status).toBe(409);
    expect(await result.response.json()).toMatchObject({
      code: 'REDVAULT_PILOT_UNAVAILABLE',
    });
    expect(result.checkoutCalled).toBe(false);
    expect(result.createDraftRpcCalled).toBe(false);
    expect(result.genericOrderRpcCalled).toBe(false);
  });

  it('judges the server-verified shipping fee rather than the client claim', async () => {
    const result = await runPilotOrder(true, 'private_live_pilot', 0, null, {
      body: {
        shipping_fee: 0.005,
        shipping_rate_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
      shippingVerification: { amount: 0, kind: 'pickup' },
    });

    expect(result.response.status).toBe(201);
    expect(result.checkoutCalled).toBe(true);
  });

  it('returns 409 at the app layer for a verified nonzero shipping fee', async () => {
    const result = await runPilotOrder(true, 'private_live_pilot', 0, null, {
      body: {
        shipping_fee: 1500,
        shipping_rate_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
      shippingVerification: { amount: 1500, kind: 'pickup' },
    });

    expect(result.response.status).toBe(409);
    expect(await result.response.json()).toMatchObject({
      code: 'REDVAULT_PILOT_UNAVAILABLE',
    });
    expect(result.checkoutCalled).toBe(false);
    expect(result.createDraftRpcCalled).toBe(false);
    expect(result.genericOrderRpcCalled).toBe(false);
  });
});
