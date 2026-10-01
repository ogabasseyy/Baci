import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/shipping', () => ({
  shippingService: {
    getProviderQuotes: vi.fn(),
    bookShipment: vi.fn(),
  },
}));

import { shippingService } from '@/lib/shipping';
import {
  correctedSender,
  createSupabase,
  mismatchedCallerSender,
  prepaidGiglCustomerCheckoutPayment,
  stubShippingService,
} from './book-order-shipment.refresh-fixtures.test-helper';

type RefreshFixturesSupabase = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>
  ) => { error: { message: string } | null };
  from: (table: string) => {
    select: (columns?: string) => {
      eq: (..._args: unknown[]) => {
        eq: (..._args: unknown[]) => unknown;
        single: () => Promise<{ data: Record<string, unknown>; error: null }>;
      };
      single: () => Promise<{ data: Record<string, unknown>; error: null }>;
    };
    upsert: (
      row: Record<string, unknown>
    ) => Promise<{ error: { message: string } | null }>;
  };
};

function fixturesSupabase(
  options?: Parameters<typeof createSupabase>[0]
): RefreshFixturesSupabase {
  return createSupabase(options) as unknown as RefreshFixturesSupabase;
}

describe('book-order-shipment.refresh-fixtures.test-helper', () => {
  beforeEach(() => {
    stubShippingService();
  });

  it('exports the corrected and mismatched sender fixtures', () => {
    expect(correctedSender).toMatchObject({
      city: 'Ikeja',
      state: 'Lagos',
      postalCode: '100001',
      countryCode: 'NG',
    });
    expect(mismatchedCallerSender).toMatchObject({
      city: 'Lagos',
      state: 'Lagos',
      address: expect.stringContaining('Lagos'),
    });
    expect(prepaidGiglCustomerCheckoutPayment).toEqual({
      payment_status: 'paid',
      payment_method: 'paystack',
      shipping_funding_source: 'customer_checkout',
      shipping_platform_retained_amount: 2500,
    });
  });

  it('stubs refreshed GIGL quote and booking responses', async () => {
    await expect(
      shippingService.getProviderQuotes('GIGL', {} as never)
    ).resolves.toEqual([
      expect.objectContaining({
        id: 'quote-refreshed',
        provider: 'GIGL',
        price: 2500,
        providerRateId: 'GIGL_4_0',
      }),
    ]);
    await expect(
      shippingService.bookShipment('GIGL', {} as never)
    ).resolves.toMatchObject({
      provider: 'GIGL',
      providerShipmentId: 'waybill-1',
      status: 'booked',
    });
  });

  it('builds a supabase mock with expired quote and prepaid checkout funding', async () => {
    const supabase = fixturesSupabase();

    const orderResult = await supabase
      .from('orders')
      .select('id')
      .eq('id', 'order-1')
      .single();
    expect(orderResult.data).toMatchObject({
      id: 'order-1',
      selected_quote_id: 'quote-1',
      shipping_funding_source: 'customer_checkout',
      payment_status: 'paid',
    });

    const quoteResult = await supabase
      .from('shipping_quotes')
      .select('id')
      .eq('id', 'quote-1')
      .single();
    expect(quoteResult.data).toMatchObject({
      id: 'quote-1',
      provider: 'GIGL',
      quote_request: expect.objectContaining({
        shipmentType: 'domestic',
        sender: expect.objectContaining({ state: '100001' }),
      }),
    });
    expect(
      new Date(String(quoteResult.data.expires_at)).getTime()
    ).toBeLessThan(Date.now());

    expect(supabase.rpc('persist_refreshed_order_shipping_quote', {})).toEqual({
      error: null,
    });
  });

  it('honors upsert errors, funding source, and corrected stored sender overrides', async () => {
    const supabase = fixturesSupabase({
      upsertError: { message: 'upsert failed' },
      fundingSource: 'merchant_wallet',
      storedSender: correctedSender,
      quoteExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const orderResult = await supabase
      .from('orders')
      .select('id')
      .eq('id', 'order-1')
      .single();
    expect(orderResult.data.shipping_funding_source).toBe('merchant_wallet');

    const quoteResult = await supabase
      .from('shipping_quotes')
      .select('id')
      .eq('id', 'quote-1')
      .single();
    expect(quoteResult.data.quote_request).toEqual(
      expect.objectContaining({ sender: correctedSender })
    );
    expect(
      new Date(String(quoteResult.data.expires_at)).getTime()
    ).toBeGreaterThan(Date.now());

    expect(supabase.rpc('persist_refreshed_order_shipping_quote', {})).toEqual({
      error: { message: 'upsert failed' },
    });
    await expect(supabase.from('shipping_quotes').upsert({})).resolves.toEqual({
      error: { message: 'upsert failed' },
    });
  });

  it('throws for unexpected tables', () => {
    const supabase = fixturesSupabase();
    expect(() => supabase.from('customers')).toThrow(
      'Unexpected table customers'
    );
  });
});
