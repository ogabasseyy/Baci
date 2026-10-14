import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { POST } from './route';

export const recoveryOrderId = '40000000-0000-4000-8000-000000000001';
export const recoveryMerchantId = '10000000-0000-4000-8000-000000000001';
export const recoveryQuoteId = '70000000-0000-4000-8000-000000000001';
export const recoveryReceiver = {
  address: '12 Test Street',
  city: 'Ikeja',
  state: 'Lagos',
  phone: '08000000000',
  latitude: 6.6018,
  longitude: 3.3515,
};
export const recoveryContext = {
  fingerprint: 'a'.repeat(64),
  quote_preference: {
    service_tier: 'standard',
    carrier_name: 'GIG Logistics',
    provider_rate_id: 'gigl:1',
    is_station_pickup: false,
  },
  order: {
    id: recoveryOrderId,
    merchant_id: recoveryMerchantId,
    customer_name: 'Test Customer',
    customer_email: null,
    customer_phone: '08000000000',
    shipping_address: {
      address: '12 Test Street',
      city: 'Ikeja',
      state: 'Lagos',
    },
    shipping_fee: 110,
    order_items: [
      {
        name: 'Phone',
        quantity: 1,
        fulfillment_quantity: 1,
        price: 1000,
        product_id: '50000000-0000-4000-8000-000000000001',
        product: {
          weight_value: 1,
          weight_unit: 'kg',
          dimensions: null,
          commodity_code: null,
        },
      },
    ],
  },
};
export const recoveryQuote = {
  id: recoveryQuoteId,
  provider: 'GIGL',
  serviceTier: 'standard',
  carrierName: 'GIG Logistics',
  displayName: 'GIG standard',
  price: 110,
  currency: 'NGN',
  estimatedDays: 2,
  pickupIncluded: true,
  insuranceIncluded: true,
  expiresAt: new Date(Date.now() + 3600000),
  providerRateId: 'gigl:1',
  providerCost: 100,
  platformMargin: 10,
  marginBasisPoints: 1000,
  pricingVersion: 'gigl_platform_margin_v1',
  rawResponse: { credential: 'private-provider-body' },
};

export type RecoveryRouteMocks = {
  auth: Mock;
  csrf: Mock;
  access: Mock;
  permission: Mock;
  rpc: Mock;
  quotes: Mock;
  sender: Mock;
};

export function primeRecoveryMocks(mocks: RecoveryRouteMocks) {
  mocks.auth.mockResolvedValue({
    user: { id: 'owner' },
    supabase: { rpc: mocks.rpc },
  });
  mocks.csrf.mockResolvedValue({ valid: true });
  mocks.access.mockResolvedValue({
    isOwner: true,
    merchantId: recoveryMerchantId,
  });
  mocks.permission.mockReturnValue(true);
  mocks.sender.mockResolvedValue({
    ok: true,
    sender: {
      ...recoveryReceiver,
      name: 'Merchant',
      country: 'Nigeria',
      countryCode: 'NG',
    },
  });
  mocks.quotes.mockResolvedValue([recoveryQuote]);
  mocks.rpc.mockImplementation(async (name: string) =>
    name === 'get_customer_checkout_shipping_recovery_context'
      ? { data: recoveryContext, error: null }
      : { data: recoveryQuoteId, error: null }
  );
}

export function postRecovery(
  body: unknown = { action: 'preview', receiver: recoveryReceiver },
  id: string = recoveryOrderId
) {
  return POST(
    new NextRequest(
      `https://usebaci.com/api/orders/${id}/shipping/checkout-recovery`,
      { method: 'POST', body: JSON.stringify(body) }
    ),
    { params: Promise.resolve({ id }) }
  );
}
