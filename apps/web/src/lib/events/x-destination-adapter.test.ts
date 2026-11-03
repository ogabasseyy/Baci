import type { DomainEventV1 } from '@baci/shared/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deliverDomainEvent } from './deliver-domain-event';
import { createEventPipelineServiceRoleTestClient } from './event-pipeline-service-role-test-client';
import { resolveEventRoute } from './event-route-resolution';

const event: DomainEventV1 = {
  data: { order_id: 'order-1' },
  domain_event_id: '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a234',
  event_name: 'analytics.purchase.completed.v1',
  external_event_id: 'stable-order-1',
  idempotency_key: 'paid-order-ad-tracking:order-1',
  merchant_id: '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a235',
  metadata: { environment: 'test' },
  occurred_at: '2026-10-24T10:00:00.000Z',
  producer: 'worker',
  schema_version: 1,
  source: {},
  subject: { id: 'order-1', type: 'order' },
  trust_level: 'server',
};
afterEach(() => vi.unstubAllGlobals());
function transport(
  paymentStatus = 'paid',
  consent = true,
  configured = true,
  hasKey = true
) {
  return vi.fn<typeof globalThis.fetch>(async (input) => {
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
      return Response.json({
        twitter_pixel_id: configured ? 'abc' : null,
        twitter_event_ids: { purchase: 'tw-abc-paid' },
      });
    if (url.includes('/merchant_x_ads_credentials?'))
      return Response.json(
        hasKey
          ? {
              consumer_key: 'key',
              consumer_secret: 'secret',
              access_token: 'token',
              access_token_secret: 'token-secret',
            }
          : null
      );
    if (url.includes('/domains?'))
      return Response.json({ domain: 'ogabassey.com' });
    if (url.includes('/orders?'))
      return Response.json({
        id: 'order-1',
        payment_status: paymentStatus,
        total: '12500',
        currency: 'NGN',
        customer_email: 'shopper@example.com',
        ad_tracking: { marketingConsent: consent },
        order_items: [],
      });
    throw new Error('Unexpected database request');
  });
}
describe('X durable paid-order wiring', () => {
  it('routes and delivers the canonical paid event through the existing dispatcher', async () => {
    const route = resolveEventRoute(event);
    expect(route.kind === 'route' && route.destinations).toContain('x');
    const db = transport();
    const provider = vi.fn().mockResolvedValue(
      Response.json({
        data: { conversions_processed: 1, debug_id: 'receipt' },
      })
    );
    vi.stubGlobal('fetch', provider);
    const result = await deliverDomainEvent({
      supabase: createEventPipelineServiceRoleTestClient(db),
      destination: 'x',
      event,
    });
    expect(result).toMatchObject({
      success: true,
      terminalOutcome: 'delivered',
    });
    expect(provider).toHaveBeenCalledTimes(1);
    const body = JSON.parse(provider.mock.calls[0][1].body);
    expect(body.conversions[0]).toMatchObject({
      event_id: 'paid',
      conversion_id: 'stable-order-1',
      price_currency: 'NGN',
      value: '12500',
    });
  });
  it.each([
    'unpaid',
    'pending',
    'failed',
    'partially_paid',
  ])('rejects %s orders before provider delivery', async (paymentStatus) => {
    const provider = vi.fn();
    vi.stubGlobal('fetch', provider);
    const result = await deliverDomainEvent({
      supabase: createEventPipelineServiceRoleTestClient(
        transport(paymentStatus)
      ),
      destination: 'x',
      event,
    });
    expect(result.success).toBe(false);
    expect(provider).not.toHaveBeenCalled();
  });
  it('skips denied consent without reading saved credentials', async () => {
    const db = transport('paid', false);
    const provider = vi.fn();
    vi.stubGlobal('fetch', provider);
    const result = await deliverDomainEvent({
      supabase: createEventPipelineServiceRoleTestClient(db),
      destination: 'x',
      event,
    });
    expect(result).toMatchObject({
      success: true,
      terminalOutcome: 'skipped',
      providerResponseId: 'consent_required',
    });
    expect(
      db.mock.calls.some(([url]) =>
        String(url).includes('merchant_x_ads_credentials')
      )
    ).toBe(false);
    expect(provider).not.toHaveBeenCalled();
  });
  it('does not accept a client observation as a paid conversion', async () => {
    const provider = vi.fn();
    vi.stubGlobal('fetch', provider);
    const result = await deliverDomainEvent({
      supabase: createEventPipelineServiceRoleTestClient(transport()),
      destination: 'x',
      event: {
        ...event,
        event_name: 'analytics.begin_checkout.v1',
        producer: 'web',
        trust_level: 'tenant_verified_client',
      },
    });
    expect(result.success).toBe(false);
    expect(provider).not.toHaveBeenCalled();
  });
});

it('loads token authentication only from the paid merchant private projection', async () => {
  const base = transport();
  const db = vi.fn<typeof fetch>(async (input, init) =>
    String(input).includes('/merchant_x_ads_credentials?')
      ? Response.json({
          pixel_token: 'synthetic-token',
          consumer_key: null,
          consumer_secret: null,
          access_token: null,
          access_token_secret: null,
        })
      : base(input, init)
  );
  const provider = vi
    .fn()
    .mockResolvedValue(Response.json({ data: { conversions_processed: 1 } }));
  vi.stubGlobal('fetch', provider);
  expect(
    await deliverDomainEvent({
      supabase: createEventPipelineServiceRoleTestClient(db),
      destination: 'x',
      event,
    })
  ).toMatchObject({ success: true, terminalOutcome: 'delivered' });
  expect(provider.mock.calls[0][1].headers).toEqual({
    'X-Pixel-Token': 'synthetic-token',
    'Content-Type': 'application/json',
  });
  const credentialRead = db.mock.calls.find(([input]) =>
    String(input).includes('/merchant_x_ads_credentials?')
  );
  expect(String(credentialRead?.[0])).toContain(event.merchant_id);
});
