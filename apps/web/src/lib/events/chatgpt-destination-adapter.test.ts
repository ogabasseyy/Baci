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
      return Response.json({ chatgpt_pixel_id: configured ? 'pixel' : null });
    if (url.includes('/merchant_chatgpt_ads_credentials?'))
      return Response.json(hasKey ? { capi_key: 'server-secret' } : null);
    if (url.includes('/domains?'))
      return Response.json({ domain: 'ogabassey.com' });
    if (url.includes('/orders?'))
      return Response.json({
        id: 'order-1',
        payment_status: paymentStatus,
        total: '12500',
        currency: 'NGN',
        ad_tracking: { chatgptConsent: consent, oppref: 'click' },
        order_items: [],
      });
    throw new Error('Unexpected database request');
  });
}
describe('ChatGPT durable paid-order wiring', () => {
  it('routes and delivers the canonical paid event through the existing dispatcher', async () => {
    const route = resolveEventRoute(event);
    expect(route.kind === 'route' && route.destinations).toContain('chatgpt');
    const db = transport();
    const provider = vi.fn().mockResolvedValue(Response.json({}));
    vi.stubGlobal('fetch', provider);
    const result = await deliverDomainEvent({
      supabase: createEventPipelineServiceRoleTestClient(db),
      destination: 'chatgpt',
      event,
    });
    expect(result).toMatchObject({
      success: true,
      terminalOutcome: 'delivered',
    });
    expect(provider).toHaveBeenCalledTimes(1);
    const body = JSON.parse(provider.mock.calls[0][1].body);
    expect(body.events[0]).toMatchObject({
      id: 'stable-order-1',
      timestamp_ms: Date.parse(event.occurred_at),
      data: { amount: 1250000, currency: 'NGN' },
    });
  });
  it.each([
    'unpaid',
    'pending',
    'failed',
    'partially_paid',
    'cancelled',
  ])('rejects %s orders before provider delivery', async (status) => {
    const provider = vi.fn();
    vi.stubGlobal('fetch', provider);
    const result = await deliverDomainEvent({
      supabase: createEventPipelineServiceRoleTestClient(transport(status)),
      destination: 'chatgpt',
      event,
    });
    expect(result.success).toBe(false);
    expect(provider).not.toHaveBeenCalled();
  });
  it('skips denied consent without reading the credential', async () => {
    const db = transport('paid', false);
    const provider = vi.fn();
    vi.stubGlobal('fetch', provider);
    const result = await deliverDomainEvent({
      supabase: createEventPipelineServiceRoleTestClient(db),
      destination: 'chatgpt',
      event,
    });
    expect(result).toMatchObject({ success: true, terminalOutcome: 'skipped' });
    expect(provider).not.toHaveBeenCalled();
    expect(
      db.mock.calls.some(([url]) =>
        String(url).includes('merchant_chatgpt_ads_credentials')
      )
    ).toBe(false);
  });
  it('does not route client observations to ChatGPT', () => {
    expect(
      resolveEventRoute({
        ...event,
        producer: 'web',
        trust_level: 'tenant_verified_client',
      }).kind
    ).toBe('dead_letter');
  });
  it('marks a lost provider response as indeterminate for the existing worker', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('lost response'))
    );
    const result = await deliverDomainEvent({
      supabase: createEventPipelineServiceRoleTestClient(transport()),
      destination: 'chatgpt',
      event,
    });
    expect(result).toMatchObject({
      success: false,
      requestMayHaveBeenSent: true,
      errorCode: 'provider_transport_failed',
    });
  });
  it('returns the HTTP status for the worker retry classifier', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('redacted', { status: 429 }))
    );
    const result = await deliverDomainEvent({
      supabase: createEventPipelineServiceRoleTestClient(transport()),
      destination: 'chatgpt',
      event,
    });
    expect(result).toMatchObject({
      success: false,
      httpStatus: 429,
      requestMayHaveBeenSent: false,
    });
  });
  it('skips a merchant without a configured pixel before reading the key', async () => {
    const db = transport('paid', true, false);
    const provider = vi.fn();
    vi.stubGlobal('fetch', provider);
    const result = await deliverDomainEvent({
      supabase: createEventPipelineServiceRoleTestClient(db),
      destination: 'chatgpt',
      event,
    });
    expect(result).toMatchObject({
      success: true,
      terminalOutcome: 'skipped',
      providerResponseId: 'not_configured',
    });
    expect(provider).not.toHaveBeenCalled();
    expect(
      db.mock.calls.some(([input]) =>
        String(input).includes('merchant_chatgpt_ads_credentials')
      )
    ).toBe(false);
  });
  it('skips a missing server key without sending a provider event', async () => {
    const provider = vi.fn();
    vi.stubGlobal('fetch', provider);
    const result = await deliverDomainEvent({
      supabase: createEventPipelineServiceRoleTestClient(
        transport('paid', true, true, false)
      ),
      destination: 'chatgpt',
      event,
    });
    expect(result).toMatchObject({
      success: true,
      terminalOutcome: 'skipped',
      providerResponseId: 'not_configured',
    });
    expect(provider).not.toHaveBeenCalled();
  });
});
