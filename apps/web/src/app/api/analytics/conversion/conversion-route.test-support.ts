import { NextRequest } from 'next/server';

export const CONVERSION_EVENT_TIME = 1_784_937_600;
export const CONVERSION_MERCHANT_ID = '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a235';

export function conversionRouteRequest(
  overrides: Record<string, unknown> = {},
  headers: Record<string, string> = {}
) {
  return new NextRequest('https://shop.usebaci.com/api/analytics/conversion', {
    body: JSON.stringify({
      analytics_consent: true,
      marketing_consent: true,
      custom_data: { currency: 'NGN', value: 100 },
      event_name: 'START_CHECKOUT',
      event_source: 'web',
      event_time: CONVERSION_EVENT_TIME,
      merchant_id: CONVERSION_MERCHANT_ID,
      user_data: {},
      ...overrides,
    }),
    headers: {
      host: 'shop.usebaci.com',
      'x-merchant-slug': 'shop',
      ...headers,
    },
    method: 'POST',
  });
}
