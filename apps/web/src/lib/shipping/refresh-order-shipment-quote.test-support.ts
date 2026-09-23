import type { ShippingAddress } from '@/lib/shipping/types';

export const storedSender: ShippingAddress = {
  name: 'Merchant',
  phone: '08000000000',
  address: '2 Olaide Tomori Street, Ikeja, Lagos',
  city: 'Lagos',
  state: 'Lagos',
  country: 'Nigeria',
  countryCode: 'NG',
};

export const correctedSender: ShippingAddress = {
  name: 'Merchant',
  phone: '08000000000',
  address: '2 Olaide Tomori Street, Ikeja, Lagos',
  city: 'Ikeja',
  state: 'Lagos',
  country: 'Nigeria',
  countryCode: 'NG',
};

export function createRefreshOrderQuote(overrides?: {
  expiresAt?: string;
  sender?: ShippingAddress;
}) {
  return {
    id: 'quote-1',
    merchant_id: 'merchant-1',
    provider: 'GIGL',
    service_tier: 'GoStandard',
    carrier_name: 'GIG Logistics',
    price: 2500,
    currency: 'NGN',
    estimated_days: 3,
    provider_rate_id: 'GIGL_4_0',
    expires_at:
      overrides?.expiresAt ?? new Date(Date.now() + 86_400_000).toISOString(),
    quote_request: {
      shipmentType: 'domestic' as const,
      sessionId: 'session-1',
      sender: overrides?.sender ?? storedSender,
      receiver: correctedSender,
      items: [{ name: 'Widget', quantity: 1, weight: 1, value: 5000 }],
    },
    provider_metadata: {},
    provider_cost: 2000,
    platform_margin: 500,
    platform_margin_bps: 2500,
    pricing_version: 'gigl_platform_margin_v1',
  };
}
