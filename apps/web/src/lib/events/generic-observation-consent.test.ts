import { afterEach, expect, it, vi } from 'vitest';
import { trackEvent } from '@/lib/event-tracking';
import type { Product } from '@/lib/products';
import { analyticsEventRequestSchema } from '@/schemas/analytics-event';
import { buildAnalyticsEventData } from './build-analytics-event-data';
import { redactEventPayload } from './event-redaction';

const product = { id: 'phone', name: 'Phone', price: 100 } as Product;
const merchantId = '11111111-1111-4111-8111-111111111111';
afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});
it.each([
  { analytics: false, marketing: false, expected: [] },
  { analytics: true, marketing: false, expected: ['facebook', 'google'] },
  { analytics: false, marketing: true, expected: ['tiktok', 'snapchat'] },
  {
    analytics: true,
    marketing: true,
    expected: ['facebook', 'google', 'tiktok', 'snapchat'],
  },
])('binds real product/cart observations to the visitor decision: %j', ({
  analytics,
  marketing,
  expected,
}) => {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({ necessary: true, analytics, marketing, functional: false })
  );
  const fetcher = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal('fetch', fetcher);
  trackEvent.productView(merchantId, product, 'NGN');
  trackEvent.addToCart(merchantId, product, 1, 'NGN');
  expect(fetcher).toHaveBeenCalledTimes(2);
  for (const [, options] of fetcher.mock.calls) {
    const body = JSON.parse(options.body);
    expect(body).toMatchObject({
      analytics_consent: analytics,
      marketing_consent: marketing,
    });
    const input = analyticsEventRequestSchema.parse(body);
    const stored = buildAnalyticsEventData(input, body.event_type);
    expect(stored.targets).toEqual(expected);
    expect(redactEventPayload(stored).targets).toEqual(expected);
  }
});
it('keeps absent consent and client-selected targets fail closed', () => {
  expect(
    buildAnalyticsEventData(
      { merchant_id: merchantId, event_type: 'product_view' },
      'product_view'
    ).targets
  ).toEqual([]);
  expect(
    analyticsEventRequestSchema.safeParse({
      merchant_id: merchantId,
      event_type: 'product_view',
      analytics_consent: 'true',
    }).success
  ).toBe(false);
});

it('does not grant a provider destination from incomplete stored preferences that the consent UI rejects', () => {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({ analytics: true })
  );
  const fetcher = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal('fetch', fetcher);
  trackEvent.productView(merchantId, product, 'NGN');
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
    analytics_consent: false,
    marketing_consent: false,
  });
});
