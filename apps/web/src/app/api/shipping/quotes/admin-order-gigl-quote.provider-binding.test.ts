import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  builtRequest,
  merchantId,
  mocks,
  orderId,
  quote,
  quoteId,
  receiver,
  setup,
  subject,
} from './admin-order-gigl-quote.test-support';

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: mocks.authenticateApiRequest,
  getUserAccess: mocks.getUserAccess,
  hasPermission: mocks.hasPermission,
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: mocks.checkCsrfProtection,
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock('@/lib/shipping/persist-admin-gigl-quote', () => ({
  persistAdminGiglQuote: mocks.persistAdminGiglQuote,
}));
vi.mock('@/lib/shipping/build-order-gigl-quote-request', () => ({
  buildOrderGiglQuoteRequest: mocks.buildOrderGiglQuoteRequest,
}));
vi.mock('@/lib/shipping/resolve-booking-merchant-sender', () => ({
  resolveBookingMerchantSender: mocks.resolveBookingMerchantSender,
}));
vi.mock('@/lib/shipping', () => ({
  ShippingService: class MockShippingService {
    getProviderQuotes(...args: unknown[]) {
      return mocks.getProviderQuotes(...args);
    }
  },
}));

describe('Admin GIGL provider, persistence, binding, and wallet behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setup();
  });

  it('maps provider transport failure to 503', async () => {
    mocks.getProviderQuotes.mockRejectedValue(new Error('GIGL timeout'));
    const response = await subject({ receiver });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'GIGL quote unavailable' });
  });

  it('rejects when no eligible GIGL door quote is returned', async () => {
    mocks.getProviderQuotes.mockResolvedValue([
      { ...quote, provider: 'TOPSHIP' },
      { ...quote, isStationPickup: true },
    ]);
    const response = await subject({ receiver });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'No eligible GIGL address-delivery quote',
    });
  });

  it('selects the cheapest eligible quote and persists full server economics and context', async () => {
    const cheaper = {
      ...quote,
      id: '44444444-4444-4444-8444-444444444444',
      price: 9_900,
    };
    mocks.getProviderQuotes.mockResolvedValue([
      { ...quote, price: 12_000 },
      cheaper,
    ]);
    const response = await subject({ receiver });
    expect(response.status).toBe(200);
    expect(mocks.persistAdminGiglQuote).toHaveBeenCalledWith(
      expect.objectContaining({
        supabase: expect.anything(),
        quote: expect.objectContaining({
          id: cheaper.id,
          price: 9_900,
          provider_cost: cheaper.providerCost,
          platform_margin: cheaper.platformMargin,
          pricing_version: cheaper.pricingVersion,
          quote_request: expect.objectContaining({
            sessionId: orderId,
            admin_order_provenance: 'server_gigl_v1',
          }),
        }),
        attestation: expect.objectContaining({
          quote_id: cheaper.id,
          order_id: orderId,
          merchant_id: merchantId,
          provider_rate_id: cheaper.providerRateId,
          quote_request: expect.objectContaining({
            admin_order_provenance: 'server_gigl_v1',
          }),
        }),
      })
    );
  });

  it('returns a safe price preview without persisting or binding a quote', async () => {
    mocks.bindRpc.mockResolvedValue({
      data: [{ available_balance: 1_000 }],
      error: null,
    });
    const response = await subject({ preview: true, receiver });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      availableBalance: 1_000,
      shortfall: 10_000,
      canBook: false,
    });
    expect(mocks.persistAdminGiglQuote).not.toHaveBeenCalled();
    expect(mocks.bindRpc).toHaveBeenCalledWith('get_wallet_summary', {
      p_merchant_id: merchantId,
    });
    expect(mocks.bindRpc).not.toHaveBeenCalledWith(
      'bind_admin_gigl_quote',
      expect.anything()
    );
  });

  it('maps trusted writer or attestation failure to a redacted 500', async () => {
    mocks.persistAdminGiglQuote.mockResolvedValue({
      data: null,
      error: { message: 'invalid_admin_quote' },
    });
    const response = await subject({ receiver });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to persist quote' });
    expect(mocks.bindRpc).not.toHaveBeenCalled();
  });

  it('binds by quote id only after the trusted writer succeeds', async () => {
    const response = await subject({ receiver });
    expect(response.status).toBe(200);
    expect(mocks.bindRpc).toHaveBeenCalledWith('bind_admin_gigl_quote', {
      p_order_id: orderId,
      p_merchant_id: merchantId,
      p_quote_id: quoteId,
      p_receiver: builtRequest.receiver,
    });
  });

  it('maps an already-transitioned order binding conflict to 409', async () => {
    mocks.bindRpc.mockResolvedValue({
      data: null,
      error: { message: 'order already shipped or booked' },
    });
    const response = await subject({ receiver });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'Order already shipped or booked',
    });
  });

  it('maps a non-conflict binder error to 500', async () => {
    mocks.bindRpc.mockResolvedValue({
      data: null,
      error: { message: 'invalid_quote_attestation' },
    });
    const response = await subject({ receiver });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to bind quote' });
  });

  it('returns wallet balance, exact shortfall, and canBook without leaking provider economics', async () => {
    mocks.bindRpc.mockResolvedValue({
      data: { available_balance: 1_000 },
      error: null,
    });
    const response = await subject({ receiver });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      availableBalance: 1_000,
      shortfall: 10_000,
      canBook: false,
    });
    expect(body.quote).not.toHaveProperty('providerCost');
    expect(body.quote).not.toHaveProperty('platformMargin');
    expect(body.quote).not.toHaveProperty('marginBasisPoints');
    expect(body.quote).not.toHaveProperty('pricingVersion');
    expect(body.quote).not.toHaveProperty('rawResponse');
  });

  it('reports canBook for exact wallet balance', async () => {
    mocks.bindRpc.mockResolvedValue({
      data: { available_balance: quote.price },
      error: null,
    });
    const body = await (await subject({ receiver })).json();
    expect(body).toMatchObject({
      availableBalance: quote.price,
      shortfall: 0,
      canBook: true,
    });
  });

  it('keeps excess wallet balance and reports no shortfall', async () => {
    mocks.bindRpc.mockResolvedValue({
      data: { available_balance: quote.price + 500 },
      error: null,
    });
    const body = await (await subject({ receiver })).json();
    expect(body).toMatchObject({
      availableBalance: quote.price + 500,
      shortfall: 0,
      canBook: true,
    });
  });

  it('does not expose the internal provider response in the public quote', async () => {
    const body = await (await subject({ receiver })).json();
    expect(body.quote).toEqual(
      expect.objectContaining({
        id: quoteId,
        provider: 'GIGL',
        price: quote.price,
      })
    );
    expect(JSON.stringify(body)).not.toContain('secretProviderPayload');
  });
});
