import type { DomainEventV1 } from '@baci/shared/contracts';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getAdTrackingData } from '@/lib/ad-tracking-cookies';
import { deliverDomainEvent } from '@/lib/events/deliver-domain-event';
import { createEventPipelineServiceRoleTestClient } from '@/lib/events/event-pipeline-service-role-test-client';
import {
  createOrderRequest,
  getLatestRpc,
  MERCHANT_ID,
  POST,
  resetOrderRouteMocks,
} from './route.transaction-discount-fixtures.test-support';

beforeEach(() => {
  resetOrderRouteMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

it.each([
  true,
  false,
])('preserves checkout consent through order persistence and paid delivery: %s', async (allowed) => {
  vi.spyOn(document, 'cookie', 'get').mockReturnValue(
    '__oppref=checkout-click; __obref=checkout-browser'
  );
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({ analytics: allowed })
  );
  const response = await POST(
    createOrderRequest({ ad_tracking: getAdTrackingData() })
  );
  expect(response.status).toBe(201);
  const write = getLatestRpc().mock.calls.find(
    ([name]) => name === 'create_storefront_order'
  )?.[1];
  expect(write?.p_ad_tracking).toMatchObject({ chatgptConsent: allowed });
  if (allowed)
    expect(write?.p_ad_tracking).toMatchObject({
      oppref: 'checkout-click',
      obref: 'checkout-browser',
    });
  else {
    expect(write?.p_ad_tracking).not.toHaveProperty('oppref');
    expect(write?.p_ad_tracking).not.toHaveProperty('obref');
  }
  const db = vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url.includes('/merchants?'))
      return Response.json({
        slug: 'ogabassey',
        plan_tier: 'pro',
        plan_expires_at: null,
        premium_features: [],
        offline_conversions_enabled: true,
      });
    if (url.includes('/merchant_feature_settings?'))
      return Response.json({ chatgpt_pixel_id: 'pixel' });
    if (url.includes('/merchant_chatgpt_ads_credentials?'))
      return Response.json({ capi_key: 'test-server-key' });
    if (url.includes('/domains?'))
      return Response.json({ domain: 'ogabassey.com' });
    if (url.includes('/orders?'))
      return Response.json({
        id: 'order-id',
        payment_status: 'paid',
        total: 1000,
        currency: 'NGN',
        ad_tracking: write?.p_ad_tracking,
        order_items: [],
      });
    throw new Error('Unexpected database request');
  });
  const provider = vi.fn().mockResolvedValue(Response.json({}));
  const client = createEventPipelineServiceRoleTestClient(db);
  vi.stubGlobal('fetch', provider);
  const event: DomainEventV1 = {
    data: { order_id: 'order-id' },
    domain_event_id: '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a234',
    event_name: 'analytics.purchase.completed.v1',
    external_event_id: 'paid-order-stable',
    idempotency_key: 'paid-order-ad-tracking:order-id',
    merchant_id: MERCHANT_ID,
    metadata: { environment: 'test' },
    occurred_at: '2026-10-24T10:00:00.000Z',
    producer: 'worker',
    schema_version: 1,
    source: {},
    subject: { id: 'order-id', type: 'order' },
    trust_level: 'server',
  };
  const result = await deliverDomainEvent({
    supabase: client,
    destination: 'chatgpt',
    event,
  });
  expect(result).toMatchObject({
    success: true,
    terminalOutcome: allowed ? 'delivered' : 'skipped',
  });
  expect(provider).toHaveBeenCalledTimes(allowed ? 1 : 0);
  if (allowed) {
    const body = JSON.parse(provider.mock.calls[0][1].body);
    expect(body.events[0]).toMatchObject({
      id: 'paid-order-stable',
      oppref: 'checkout-click',
      user: { obref: 'checkout-browser' },
      data: { amount: 100000, currency: 'NGN' },
    });
  }
});
