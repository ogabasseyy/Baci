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

export function buildInternationalBookingRequest(): NextRequest {
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
        phone: '+14165550123',
        address: '999 New Address',
        city: 'Vancouver',
        state: 'British Columbia',
        country: 'Canada',
        countryCode: 'CA',
      },
      items: [{ name: 'Phone', quantity: 1, weight: 1, value: 500000 }],
    }),
  }) as unknown as NextRequest;
}

export function buildInternationalSupabaseMock({
  matchingDestination = false,
  selectedQuoteId = '22222222-2222-4222-8222-222222222222',
  merchantSenderAvailable = true,
  storedSenderAvailable = true,
}: {
  matchingDestination?: boolean;
  selectedQuoteId?: string | null;
  merchantSenderAvailable?: boolean;
  storedSenderAvailable?: boolean;
} = {}) {
  const quoteReceiver = matchingDestination
    ? {
        name: 'Old Recipient',
        phone: '',
        address: '999 New Address',
        city: 'Vancouver',
        state: 'British Columbia',
        country: 'Canada',
        countryCode: 'CA',
      }
    : {
        name: 'Old Recipient',
        phone: '',
        address: '123 Queen Street West',
        city: 'Toronto',
        state: 'Ontario',
        country: 'Canada',
        countryCode: 'CA',
      };
  const ordersSelectChain = {
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: {
        id: '11111111-1111-4111-8111-111111111111',
        merchant_id: 'merchant-1',
        selected_quote_id: selectedQuoteId,
        ...prepaidGiglCustomerCheckoutOrderFields,
        shipping_status: 'pending',
        shipping_address: {
          address: '999 New Address',
          city: 'Vancouver',
          state: 'British Columbia',
          country: 'Canada',
          countryCode: 'CA',
        },
        order_items: [{ name: 'Phone', quantity: 1, price: 500000 }],
      },
      error: null,
    }),
  };
  const mutationChain = {
    eq: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi
      .fn()
      .mockResolvedValue({ data: { id: 'shipment-1' }, error: null }),
    maybeSingle: vi
      .fn()
      .mockResolvedValue({ data: { id: 'order-1' }, error: null }),
  };
  const shipmentLookupChain = {
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
  const quotesSelectChain = {
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockImplementation(() => {
      expect(quotesSelectChain.eq).toHaveBeenCalledWith(
        'merchant_id',
        'merchant-1'
      );
      return Promise.resolve({
        data: {
          id: '22222222-2222-4222-8222-222222222222',
          merchant_id: 'merchant-1',
          provider: 'GIGL',
          provider_rate_id: 'GIGL_INTL_1_2_3_1',
          provider_metadata: {},
          quote_request: {
            merchantId: 'merchant-1',
            sessionId: 'session-1',
            shipmentType: 'international',
            ...(storedSenderAvailable
              ? {
                  sender: {
                    name: 'Quoted Merchant Store',
                    phone: '+2348099999999',
                    address: '7 Quoted Origin',
                    city: 'Ikeja',
                    state: 'Lagos',
                    country: 'Nigeria',
                    countryCode: 'NG',
                  },
                }
              : {}),
            receiver: quoteReceiver,
            items: [{ name: 'Phone', quantity: 1, weight: 1, value: 500000 }],
          },
          expires_at: new Date(Date.now() + 60_000).toISOString(),
          price: 4500,
          currency: 'NGN',
          estimated_days: 2,
          ...giglQuoteEconomicsFields,
        },
        error: null,
      });
    }),
  };

  return {
    rpc: vi.fn().mockImplementation((fn: string) => {
      if (fn === 'get_shipping_quote_booking_metadata') {
        return Promise.resolve({ data: null, error: null });
      }
      if (fn === 'get_shipping_quote_booking_economics') {
        return Promise.resolve({
          data: giglBookingEconomicsProjection,
          error: null,
        });
      }
      return Promise.resolve({
        data: [{ claimed: true, shipment_id: null, tracking_number: null }],
        error: null,
      });
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
          update: vi.fn(() => mutationChain),
        };
      }
      if (table === 'shipping_quotes') {
        return {
          select: vi.fn(() => quotesSelectChain),
          update: vi.fn(() => mutationChain),
        };
      }
      if (table === 'shipments') {
        return {
          insert: vi.fn(() => mutationChain),
          select: vi.fn(() => shipmentLookupChain),
        };
      }
      if (table === 'merchants') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: merchantSenderAvailable
                ? {
                    business_name: 'Registered Merchant Store',
                    business_address: '9 Registered Road, Ikeja, Lagos',
                    phone: '+2348012345678',
                    registered_address: {
                      city: 'Ikeja',
                      state: 'Lagos',
                      street: '9 Registered Road',
                    },
                    state_code: 'LA',
                  }
                : null,
              error: null,
            }),
          })),
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
