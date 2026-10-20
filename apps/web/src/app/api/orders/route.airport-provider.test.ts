import './shipping-route.test-support';
import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { POST } from './route';
import {
  baseOrderPayload,
  buildMockSupabase,
  MERCHANT_ID,
  resetShippingRouteMocks,
} from './shipping-route.test-fixtures';

beforeEach(resetShippingRouteMocks);
it('persists a first airport checkout with the quote-derived GIGL provider', async () => {
  const selectedQuoteId = '22222222-2222-4222-8222-222222222222';
  const address = {
    address: '12 Allen Avenue, Ikeja, Lagos',
    city: 'Ikeja',
    state: 'Lagos',
  };
  const supabase = buildMockSupabase(
    {},
    {
      productRows: [{ id: 'p-1', name: 'Widget', price: 1000 }],
      shippingQuote: {
        provider: 'GIGL',
        provider_rate_id: 'GIGL_30_0_1_0_1_4',
        price: 2500,
        expires_at: '2099-01-01T00:00:00Z',
        quote_request: {
          merchantId: MERCHANT_ID,
          sessionId: 'session-1',
          shipmentType: 'domestic',
          receiver: {
            ...address,
            name: 'Test Customer',
            phone: '08012345678',
            country: 'Nigeria',
            countryCode: 'NG',
            latitude: 6.5244,
            longitude: 3.3792,
          },
          items: [{ name: 'Widget', quantity: 1, weight: 1, value: 1000 }],
        },
      },
    }
  );
  const server = await import('@/lib/supabase/server');
  vi.mocked(server.createClient).mockImplementation(() => supabase as never);
  const response = await POST(
    new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...baseOrderPayload,
        subtotal: 1000,
        shipping_fee: 2500,
        shipping_address: address,
        selected_quote_id: selectedQuoteId,
        delivery_method: 'airport',
        airport_type: 'delivery',
      }),
    })
  );
  expect(response.status).toBe(201);
  expect(supabase.rpc).toHaveBeenCalledWith(
    'create_storefront_order',
    expect.objectContaining({
      p_selected_quote_id: selectedQuoteId,
      p_shipping_provider: 'GIGL',
      p_shipping_address: expect.objectContaining({
        latitude: 6.5244,
        longitude: 3.3792,
      }),
    })
  );
});
