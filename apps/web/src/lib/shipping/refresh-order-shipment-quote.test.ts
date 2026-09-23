import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrderShipmentBookingError } from '@/lib/shipping/order-shipment-booking-utils';
import {
  correctedSender,
  createRefreshOrderQuote,
  storedSender,
} from './refresh-order-shipment-quote.test-support';

vi.mock('@/lib/shipping', () => ({
  shippingService: {
    getProviderQuotes: vi.fn(),
  },
}));

vi.mock('server-only', () => ({}));

vi.mock('@/env', () => ({
  getSupabaseServiceRoleKey: () => 's'.repeat(32),
}));

const { refreshOrderShipmentQuote } = await import(
  './refresh-order-shipment-quote'
);
const { shippingService } = await import('@/lib/shipping');

function createSupabase(
  upsertError: { code: string; message: string } | null = null
) {
  return {
    rpc: vi.fn().mockResolvedValue({ error: upsertError }),
  };
}

describe('refreshOrderShipmentQuote', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(shippingService.getProviderQuotes).mockResolvedValue([
      {
        id: 'quote-refreshed',
        provider: 'GIGL',
        serviceTier: 'GoStandard',
        carrierName: 'GIG Logistics',
        displayName: 'GIG Logistics - GoStandard',
        price: 2500,
        currency: 'NGN',
        estimatedDays: 3,
        pickupIncluded: true,
        insuranceIncluded: false,
        providerRateId: 'GIGL_4_0',
        expiresAt: new Date(Date.now() + 86_400_000),
        rawResponse: { refreshed: true },
      },
    ]);
  });

  it('returns the stored quote when it is unexpired and the sender already matches', async () => {
    const quote = createRefreshOrderQuote({ sender: correctedSender });

    const result = await refreshOrderShipmentQuote(
      createSupabase() as never,
      quote,
      'GIGL',
      correctedSender
    );

    expect(result).toBe(quote);
    expect(shippingService.getProviderQuotes).not.toHaveBeenCalled();
  });

  it('refreshes and persists when an unexpired domestic sender differs', async () => {
    const quote = createRefreshOrderQuote({ sender: storedSender });
    const supabase = createSupabase();

    const result = await refreshOrderShipmentQuote(
      supabase as never,
      quote,
      'GIGL',
      correctedSender,
      { orderId: 'order-1' }
    );

    expect(shippingService.getProviderQuotes).toHaveBeenCalledWith(
      'GIGL',
      expect.objectContaining({ sender: correctedSender })
    );
    expect(result.id).toBe('quote-refreshed');
    expect(supabase.rpc).toHaveBeenCalledWith(
      'persist_refreshed_order_shipping_quote',
      expect.objectContaining({
        p_quote: expect.objectContaining({ id: 'quote-refreshed' }),
      })
    );
  });

  it('fails closed before the provider when no order identity is supplied', async () => {
    const quote = createRefreshOrderQuote({ sender: storedSender });
    await expect(
      refreshOrderShipmentQuote(
        createSupabase() as never,
        quote,
        'GIGL',
        correctedSender
      )
    ).rejects.toMatchObject({ code: 'QUOTE_REFRESH_ORDER_REQUIRED' });
    expect(shippingService.getProviderQuotes).not.toHaveBeenCalled();
  });

  it('attests a refreshed Admin GIGL quote to the wallet order', async () => {
    const quote = {
      ...createRefreshOrderQuote({
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      }),
      quote_request: {
        ...createRefreshOrderQuote().quote_request,
        admin_order_provenance: 'server_gigl_v1' as const,
      },
    };
    const supabase = createSupabase();

    const result = await refreshOrderShipmentQuote(
      supabase as never,
      quote,
      'GIGL',
      correctedSender,
      { orderId: 'order-1' }
    );

    expect(result.id).toBe('quote-refreshed');
    expect(supabase.rpc).toHaveBeenCalledWith(
      'persist_refreshed_order_shipping_quote',
      expect.objectContaining({
        p_order_id: 'order-1',
        p_quote: expect.objectContaining({
          id: 'quote-refreshed',
          merchant_id: 'merchant-1',
          session_id: 'order-1',
          provider: 'GIGL',
        }),
      })
    );
  });

  it('fails before the provider when refresh is disabled for a stale wallet quote', async () => {
    const quote = createRefreshOrderQuote({
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });

    await expect(
      refreshOrderShipmentQuote(
        createSupabase() as never,
        quote,
        'GIGL',
        correctedSender,
        { allowRefresh: false }
      )
    ).rejects.toMatchObject({
      code: 'MERCHANT_WALLET_QUOTE_RECONFIRM_REQUIRED',
      status: 409,
    });
    expect(shippingService.getProviderQuotes).not.toHaveBeenCalled();
  });

  it('fails before the provider when refresh is disabled for a changed sender', async () => {
    const quote = createRefreshOrderQuote({ sender: storedSender });

    await expect(
      refreshOrderShipmentQuote(
        createSupabase() as never,
        quote,
        'GIGL',
        correctedSender,
        { allowRefresh: false }
      )
    ).rejects.toMatchObject({
      code: 'MERCHANT_WALLET_QUOTE_RECONFIRM_REQUIRED',
      status: 409,
    });
    expect(shippingService.getProviderQuotes).not.toHaveBeenCalled();
  });

  it('preserves the selected pickup centre when refreshing a legacy GIGL rate ID', async () => {
    const quote = {
      ...createRefreshOrderQuote({ sender: storedSender }),
      provider_rate_id: 'GIGL_30_1_1_575_0',
    };
    vi.mocked(shippingService.getProviderQuotes).mockResolvedValueOnce([
      {
        id: 'wrong-centre',
        provider: 'GIGL',
        serviceTier: 'GoStandard',
        carrierName: 'GIG Logistics',
        displayName: 'Pickup at another centre',
        price: 2400,
        currency: 'NGN',
        estimatedDays: 3,
        pickupIncluded: true,
        insuranceIncluded: false,
        providerRateId: 'GIGL_30_1_1_576_0_4',
        expiresAt: new Date('2099-01-02T00:00:00.000Z'),
        rawResponse: {},
      },
      {
        id: 'selected-centre',
        provider: 'GIGL',
        serviceTier: 'GoStandard',
        carrierName: 'GIG Logistics',
        displayName: 'Pickup at selected centre',
        price: 2500,
        currency: 'NGN',
        estimatedDays: 3,
        pickupIncluded: true,
        insuranceIncluded: false,
        providerRateId: 'GIGL_30_1_1_575_0_4',
        expiresAt: new Date('2099-01-02T00:00:00.000Z'),
        rawResponse: {},
      },
    ]);

    const result = await refreshOrderShipmentQuote(
      createSupabase() as never,
      quote,
      'GIGL',
      correctedSender,
      { orderId: 'order-1' }
    );

    expect(result.id).toBe('selected-centre');
    expect(result.provider_rate_id).toBe('GIGL_30_1_1_575_0_4');
  });

  it('refreshes an unexpired domestic quote when its saved sender is missing', async () => {
    const storedQuote = createRefreshOrderQuote({ sender: correctedSender });
    const { sender: _sender, ...quoteRequestWithoutSender } =
      storedQuote.quote_request;
    const quote = {
      ...storedQuote,
      quote_request: quoteRequestWithoutSender,
    };

    await refreshOrderShipmentQuote(
      createSupabase() as never,
      quote,
      'GIGL',
      correctedSender,
      { orderId: 'order-1' }
    );

    expect(shippingService.getProviderQuotes).toHaveBeenCalledWith(
      'GIGL',
      expect.objectContaining({ sender: correctedSender })
    );
  });

  describe('bugfix: live legacy GIGL quotes missing economics must refresh', () => {
    it('refreshes an unexpired GIGL quote when pricing_version is null', async () => {
      const quote = {
        ...createRefreshOrderQuote({ sender: correctedSender }),
        pricing_version: null,
        provider_cost: null,
        platform_margin: null,
        platform_margin_bps: null,
      };

      const result = await refreshOrderShipmentQuote(
        createSupabase() as never,
        quote,
        'GIGL',
        correctedSender,
        { orderId: 'order-1' }
      );

      expect(shippingService.getProviderQuotes).toHaveBeenCalled();
      expect(result.id).toBe('quote-refreshed');
    });

    it('requires wallet reconfirm when refresh is disabled for missing economics', async () => {
      const quote = {
        ...createRefreshOrderQuote({ sender: correctedSender }),
        pricing_version: null,
      };

      await expect(
        refreshOrderShipmentQuote(
          createSupabase() as never,
          quote,
          'GIGL',
          correctedSender,
          { allowRefresh: false, orderId: 'order-1' }
        )
      ).rejects.toMatchObject({
        code: 'MERCHANT_WALLET_QUOTE_RECONFIRM_REQUIRED',
        status: 409,
      });
      expect(shippingService.getProviderQuotes).not.toHaveBeenCalled();
    });
  });

  describe('bugfix: do not rebind a repriced quote before fee validation', () => {
    it('rejects a price-changed refresh before persisting the replacement', async () => {
      const quote = createRefreshOrderQuote({
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      });
      vi.mocked(shippingService.getProviderQuotes).mockResolvedValueOnce([
        {
          id: 'quote-repriced',
          provider: 'GIGL',
          serviceTier: 'GoStandard',
          carrierName: 'GIG Logistics',
          displayName: 'GIG Logistics - GoStandard',
          price: 9999,
          currency: 'NGN',
          estimatedDays: 3,
          pickupIncluded: true,
          insuranceIncluded: false,
          providerRateId: 'GIGL_4_0',
          expiresAt: new Date(Date.now() + 86_400_000),
          rawResponse: { refreshed: true },
        },
      ]);
      const supabase = createSupabase();

      await expect(
        refreshOrderShipmentQuote(
          supabase as never,
          quote,
          'GIGL',
          correctedSender,
          { orderId: 'order-1', expectedShippingFee: 2500 }
        )
      ).rejects.toMatchObject({
        code: 'QUOTE_PRICE_CHANGED',
        status: 400,
      });
      expect(supabase.rpc).not.toHaveBeenCalled();
    });
  });

  describe('bugfix: upsert failure must not continue booking', () => {
    it('throws QUOTE_REFRESH_PERSIST_FAILED when the refreshed quote cannot be saved', async () => {
      const quote = createRefreshOrderQuote({
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      });
      const upsertError = { code: '42501', message: 'permission denied' };

      await expect(
        refreshOrderShipmentQuote(
          createSupabase(upsertError) as never,
          quote,
          'GIGL',
          correctedSender,
          { orderId: 'order-1' }
        )
      ).rejects.toMatchObject({
        code: 'QUOTE_REFRESH_PERSIST_FAILED',
      } satisfies Partial<OrderShipmentBookingError>);
    });
  });
});
