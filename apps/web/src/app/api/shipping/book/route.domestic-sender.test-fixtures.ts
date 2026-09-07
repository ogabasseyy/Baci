import type { NextRequest } from 'next/server';
import { expect, vi } from 'vitest';
import {
  giglBookingEconomicsProjection,
  giglQuoteEconomicsFields,
  prepaidGiglCustomerCheckoutOrderFields,
} from './route.test-fixtures';

function createSettledRetentionEqChain(
  retainedAmount = giglBookingEconomicsProjection.shipping_platform_retained_amount
) {
  const eqSourceId = vi.fn().mockResolvedValue({
    data: [
      {
        metadata: { retained_shipping_amount: retainedAmount },
        status: 'completed',
      },
    ],
    error: null,
  });
  const eqSourceType = vi.fn(() => ({ eq: eqSourceId }));
  const eqMerchant = vi.fn(() => ({ eq: eqSourceType }));
  return { eq: eqMerchant };
}

export const domesticSenderShipmentInsertPayloads: unknown[] = [];

export function buildDomesticSenderSupabaseMock(
  quoteOverrides: Record<string, unknown> = {}
) {
  const ordersSelectChain = {
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: {
        id: '11111111-1111-4111-8111-111111111111',
        merchant_id: 'merchant-1',
        selected_quote_id: '22222222-2222-4222-8222-222222222222',
        ...prepaidGiglCustomerCheckoutOrderFields,
        shipping_status: 'pending',
        shipping_address: {
          address: '123 Queen Street West',
          city: 'Toronto',
          state: 'Ontario',
          country: 'Canada',
          countryCode: 'CA',
          postalCode: 'M5V 3L9',
        },
        order_items: [
          {
            name: 'Phone',
            quantity: 1,
            price: 500000,
            product: {
              weight_value: 1,
              weight_unit: 'kg',
              dimensions: { length: 10, width: 8, height: 6, unit: 'cm' },
              commodity_code: '851712',
            },
          },
        ],
      },
      error: null,
    }),
  };
  const quotesSelectChain = {
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: {
        id: '22222222-2222-4222-8222-222222222222',
        merchant_id: 'merchant-1',
        provider: 'GIGL',
        provider_rate_id: 'gigl:service-centre:5',
        provider_metadata: { stationId: 5 },
        quote_request: null,
        expires_at: '2099-01-01T00:00:00.000Z',
        price: 4500,
        currency: 'NGN',
        estimated_days: 2,
        ...giglQuoteEconomicsFields,
        ...quoteOverrides,
      },
      error: null,
    }),
  };
  const shipmentInsertSelectChain = {
    single: vi
      .fn()
      .mockResolvedValue({ data: { id: 'shipment-1' }, error: null }),
  };
  const shipmentInsertChain = {
    select: vi.fn().mockReturnValue(shipmentInsertSelectChain),
  };
  const shipmentLookupChain = {
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
  const shippingQuoteUpdateChain = {
    error: null,
    eq: vi.fn(),
  };
  shippingQuoteUpdateChain.eq.mockReturnValue(shippingQuoteUpdateChain);
  const merchantSelectChain = {
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: {
        business_name: 'Registered Merchant Store',
        business_address: '9 Registered Road, Ikeja, Lagos',
        phone: '+2348012345678',
        registered_address: {
          city: 'Ikeja',
          postal_code: '100001',
          state: 'Lagos',
          street: '9 Registered Road',
        },
        state_code: 'LA',
      },
      error: null,
    }),
  };

  return {
    rpc: vi.fn().mockImplementation((fn: string) => {
      if (fn === 'get_shipping_quote_booking_metadata') {
        return { data: null, error: null };
      }
      if (fn === 'get_shipping_quote_booking_economics') {
        return { data: giglBookingEconomicsProjection, error: null };
      }
      if (fn === 'persist_refreshed_order_shipping_quote') {
        return { error: null };
      }
      return {
        data: [{ claimed: true, shipment_id: null, tracking_number: null }],
        error: null,
      };
    }),
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'user-1' } },
        error: null,
      }),
    },
    from: vi.fn((table: string) => {
      if (table === 'orders') {
        return {
          select: vi.fn(() => ordersSelectChain),
          update: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            select: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: 'order-1' },
                error: null,
              }),
            })),
          })),
        };
      }

      if (table === 'shipping_quotes') {
        return {
          select: vi.fn((columns: string) => {
            expect(columns).toContain('provider,');
            expect(columns).not.toContain('provider_code');
            return quotesSelectChain;
          }),
          update: vi.fn(() => shippingQuoteUpdateChain),
          upsert: vi.fn().mockResolvedValue({ error: null }),
        };
      }

      if (table === 'shipments') {
        return {
          insert: vi.fn((payload: unknown) => {
            domesticSenderShipmentInsertPayloads.push(payload);
            return shipmentInsertChain;
          }),
          select: vi.fn(() => shipmentLookupChain),
        };
      }

      if (table === 'merchants') {
        return {
          select: vi.fn(() => merchantSelectChain),
        };
      }

      if (table === 'merchant_settlements') {
        return {
          select: vi.fn(() => createSettledRetentionEqChain()),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };
}

export function buildDomesticSenderBookingRequest(): NextRequest {
  return new Request('https://usebaci.com/api/shipping/book', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orderId: '11111111-1111-4111-8111-111111111111',
      carrierId: 'GIGL',
      quoteId: '22222222-2222-4222-8222-222222222222',
      sender: {
        name: 'Merchant Store',
        phone: '+2348011111111',
        address: '1 Merchant Road',
        city: 'Lagos',
        state: 'Lagos',
        country: 'Nigeria',
        countryCode: 'NG',
      },
      receiver: {
        name: 'Jane Customer',
        phone: '+2348022222222',
        address: '123 Queen Street West',
        city: 'Toronto',
        state: 'Ontario',
        country: 'Canada',
        countryCode: 'CA',
        postalCode: 'M5V 3L9',
      },
      items: [
        {
          name: 'Phone',
          quantity: 1,
          weight: 1,
          value: 500000,
          hsCode: '851712',
          length: 10,
          width: 8,
          height: 6,
        },
      ],
    }),
  }) as unknown as NextRequest;
}
