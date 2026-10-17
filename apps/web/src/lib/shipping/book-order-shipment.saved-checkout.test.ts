import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shippingQuoteEnvTestMock } from './shipping-quote-env.test-mock';

type EnvModule = typeof import('@/env');

vi.mock('@/env', async (original) => {
  const actual = await original<EnvModule>();
  return { ...actual, ...shippingQuoteEnvTestMock };
});
vi.mock('@/lib/shipping', () => ({
  shippingService: { getProviderQuotes: vi.fn(), bookShipment: vi.fn() },
}));
const { shippingService } = await import('@/lib/shipping');
const { bookOrderShipment } = await import('./book-order-shipment');
const { createSupabase, correctedSender, stubShippingService } = await import(
  './book-order-shipment.refresh-fixtures.test-helper'
);

async function fixture() {
  const client = createSupabase({
    storedSender: correctedSender,
  }) as SupabaseClient;
  const orderResult = await client.from('orders').select().single();
  delete orderResult.data.shipping_address.latitude;
  delete orderResult.data.shipping_address.longitude;
  const quoteResult = await client.from('shipping_quotes').select().single();
  const quote = quoteResult.data as unknown as {
    quote_request: { receiver: { latitude?: number; longitude?: number } };
  };
  Object.assign(quote.quote_request.receiver, {
    latitude: 6.5,
    longitude: 3.3,
  });
  const fresh = vi
    .mocked(shippingService.getProviderQuotes)
    .getMockImplementation();
  // Read the controlled provider fixture; all carrier operations remain mocked.
  const quotes = await fresh?.('GIGL', {} as never);
  if (!quotes?.[0]) throw new Error('missing test quote');
  vi.mocked(shippingService.getProviderQuotes).mockResolvedValue([
    {
      ...quotes[0],
      providerCost: 2000,
      platformMargin: 500,
      marginBasisPoints: 2000,
      pricingVersion: 'gigl_platform_margin_v1',
    },
  ]);
  vi.mocked(shippingService.getProviderQuotes).mockClear();
  return client;
}
describe('saved GIG checkout booking integration', () => {
  beforeEach(stubShippingService);
  it('books an expired quote with its original ID and quoted pins after unchanged background pricing', async () => {
    const client = await fixture();
    await bookOrderShipment(client, 'merchant-1', 'order-1');
    expect(shippingService.getProviderQuotes).toHaveBeenCalledOnce();
    expect(shippingService.bookShipment).toHaveBeenCalledWith(
      'GIGL',
      expect.objectContaining({
        quoteId: 'quote-1',
        receiver: expect.objectContaining({ latitude: 6.5, longitude: 3.3 }),
      })
    );
    expect(client.rpc).not.toHaveBeenCalledWith(
      'persist_refreshed_order_shipping_quote',
      expect.anything()
    );
  });
  it('does not book or replace the paid quote when provider cost changes', async () => {
    const client = await fixture();
    const current = await vi
      .mocked(shippingService.getProviderQuotes)
      .getMockImplementation()?.('GIGL', {} as never);
    vi.mocked(shippingService.getProviderQuotes).mockResolvedValue([
      {
        ...(current?.[0] as NonNullable<typeof current>[number]),
        providerCost: 2100,
      },
    ]);
    await expect(
      bookOrderShipment(client, 'merchant-1', 'order-1')
    ).rejects.toMatchObject({
      code: 'SHIPPING_QUOTE_RECONFIRM_REQUIRED',
      status: 409,
    });
    expect(shippingService.bookShipment).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalledWith(
      'persist_refreshed_order_shipping_quote',
      expect.anything()
    );
  });
  it('requires confirmation when an original parcel snapshot contains now-refunded units', async () => {
    const client = await fixture();
    const result = await client.from('orders').select().single();
    Object.assign(result.data.order_items[0], {
      quantity: 2,
      fulfillment_data: { fulfillmentQuantity: 1 },
    });
    const saved = await client.from('shipping_quotes').select().single();
    saved.data.quote_request.items[0].quantity = 2;
    await expect(
      bookOrderShipment(client, 'merchant-1', 'order-1')
    ).rejects.toMatchObject({
      code: 'SHIPPING_QUOTE_RECONFIRM_REQUIRED',
      status: 409,
    });
    expect(shippingService.bookShipment).not.toHaveBeenCalled();
    expect(shippingService.getProviderQuotes).not.toHaveBeenCalled();
  });
  it.each([
    { business_name: 'Different store' },
    { phone: '08000000002' },
  ])('does not check prices or submit a booking when only current sender contact changes %j', async (change) => {
    const client = await fixture();
    const merchant = await client.from('merchants').select().single();
    Object.assign(merchant.data, change);
    await expect(
      bookOrderShipment(client, 'merchant-1', 'order-1')
    ).rejects.toMatchObject({
      code: 'SHIPPING_QUOTE_RECONFIRM_REQUIRED',
      status: 409,
    });
    expect(shippingService.getProviderQuotes).not.toHaveBeenCalled();
    expect(shippingService.bookShipment).not.toHaveBeenCalled();
  });
  it.each([
    { pricing_version: null, provider_cost: null },
    { quote_request: null },
  ])('requires recovery without pricing or carrier submission for a legacy saved quote %j', async (legacy) => {
    const client = await fixture();
    const saved = await client.from('shipping_quotes').select().single();
    Object.assign(saved.data, legacy);
    await expect(
      bookOrderShipment(client, 'merchant-1', 'order-1')
    ).rejects.toMatchObject({
      code: 'SHIPPING_QUOTE_RECONFIRM_REQUIRED',
      status: 409,
    });
    expect(shippingService.getProviderQuotes).not.toHaveBeenCalled();
    expect(shippingService.bookShipment).not.toHaveBeenCalled();
  });
  it.each([
    [0, 0],
    [9.3, 13.4],
  ])('rejects a foreign saved destination %s,%s before tariff lookup or booking', async (latitude, longitude) => {
    const client = await fixture();
    const saved = await client.from('shipping_quotes').select().single();
    Object.assign(saved.data.quote_request.receiver, { latitude, longitude });
    await expect(
      bookOrderShipment(client, 'merchant-1', 'order-1')
    ).rejects.toMatchObject({
      code: 'SHIPPING_QUOTE_RECEIVER_MISMATCH',
      status: 400,
    });
    expect(shippingService.getProviderQuotes).not.toHaveBeenCalled();
    expect(shippingService.bookShipment).not.toHaveBeenCalled();
  });
  it('books the original quote without persisting replacement labels when the carrier renamed the same service', async () => {
    const client = await fixture();
    const saved = await client.from('shipping_quotes').select().single();
    Object.assign(saved.data, {
      service_tier: 'standard',
      carrier_name: 'GIGL',
    });
    await expect(
      bookOrderShipment(client, 'merchant-1', 'order-1')
    ).resolves.toMatchObject({ quoteId: 'quote-1' });
    expect(shippingService.bookShipment).toHaveBeenCalledWith(
      'GIGL',
      expect.objectContaining({
        quoteId: 'quote-1',
        providerRateId: 'GIGL_4_0_1_0_0_4',
      })
    );
    expect(saved.data).toMatchObject({
      service_tier: 'standard',
      carrier_name: 'GIGL',
      price: 2500,
      provider_cost: 2000,
    });
    expect(client.rpc).not.toHaveBeenCalledWith(
      'persist_refreshed_order_shipping_quote',
      expect.anything()
    );
  });
  it('does not price or submit a booking from a saved rate with a defaulted invalid enum', async () => {
    const client = await fixture();
    const saved = await client.from('shipping_quotes').select().single();
    saved.data.provider_rate_id = 'GIGL_4_9_1_0_0_4';
    await expect(
      bookOrderShipment(client, 'merchant-1', 'order-1')
    ).rejects.toMatchObject({
      code: 'SHIPPING_QUOTE_RECONFIRM_REQUIRED',
      status: 409,
    });
    expect(shippingService.getProviderQuotes).not.toHaveBeenCalled();
    expect(shippingService.bookShipment).not.toHaveBeenCalled();
  });
  it('returns a definitive pre-booking error if background checking fails', async () => {
    const client = await fixture();
    vi.mocked(shippingService.getProviderQuotes).mockRejectedValue(
      new Error('network failure')
    );
    await expect(
      bookOrderShipment(client, 'merchant-1', 'order-1')
    ).rejects.toMatchObject({ code: 'QUOTE_REFRESH_FAILED', status: 409 });
    expect(shippingService.bookShipment).not.toHaveBeenCalled();
  });
});
