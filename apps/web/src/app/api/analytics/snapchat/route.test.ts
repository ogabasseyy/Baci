// @vitest-environment node
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  record: vi.fn(),
  ingress: vi.fn(),
  client: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }));
vi.mock('@/lib/events/event-ingress-context', () => ({
  resolveEventIngressContext: mocks.context,
}));
vi.mock('@/lib/events/event-ingress-capability', () => ({
  createEventIngressClient: mocks.ingress,
}));
vi.mock('@/lib/events/record-analytics-domain-event', () => ({
  recordAnalyticsDomainEvent: mocks.record,
}));

import { POST } from './route';

const merchantId = '11111111-1111-4111-8111-111111111111';
const payload = {
  event: 'view_item',
  merchantId,
  consent: true,
  eventId: 'cart-event-1',
  eventSourceUrl: 'https://ogabassey.com/cart',
  eventData: {
    currency: 'NGN',
    value: 200,
    products: [{ id: 'product-1', name: 'Phone', quantity: 1, price: 200 }],
  },
};
function request(body: unknown) {
  return new NextRequest('https://ogabassey.com/api/analytics/snapchat', {
    method: 'POST',
    headers: { host: 'ogabassey.com', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.client.mockResolvedValue({});
  mocks.ingress.mockReturnValue({});
  mocks.context.mockResolvedValue({
    ok: true,
    verified: true,
    merchantId,
    trustLevel: 'tenant_verified_client',
  });
  mocks.record.mockResolvedValue({ domain_event_id: 'domain-1' });
});
describe('storefront CAPI ingress', () => {
  it('queues a host-verified event without reading private credentials as the visitor', async () => {
    const response = await POST(request(payload));
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      queued: true,
      eventId: 'cart-event-1',
      sent: false,
    });
    expect(mocks.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        merchantId,
        externalEventId: 'cart-event-1',
        eventName: 'analytics.product_view.v1',
        eventType: 'product_view',
        eventData: expect.objectContaining({
          currency: 'NGN',
          targets: ['snapchat'],
          value: 200,
          items: payload.eventData.products,
        }),
      })
    );
  });
  it('binds another merchant observation to that merchant alone', async () => {
    const otherMerchantId = '22222222-2222-4222-8222-222222222222';
    mocks.context.mockResolvedValue({
      ok: true,
      verified: true,
      merchantId: otherMerchantId,
      trustLevel: 'tenant_verified_client',
    });
    const response = await POST(
      request({ ...payload, merchantId: otherMerchantId })
    );
    expect(response.status).toBe(202);
    expect(mocks.ingress).toHaveBeenCalledWith(
      expect.objectContaining({ merchantId: otherMerchantId })
    );
    expect(mocks.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ merchantId: otherMerchantId })
    );
  });
  it('rejects a body-selected merchant that does not match the storefront', async () => {
    mocks.context.mockResolvedValue({ ok: false, code: 'merchant_mismatch' });
    expect((await POST(request(payload))).status).toBe(403);
    expect(mocks.record).not.toHaveBeenCalled();
  });
  it('rejects unverified tenant context', async () => {
    mocks.context.mockResolvedValue({
      ok: true,
      verified: false,
      merchantId,
      trustLevel: 'anonymous_client',
    });
    expect((await POST(request(payload))).status).toBe(403);
    expect(mocks.record).not.toHaveBeenCalled();
  });
  it.each([
    { ...payload, event: 'Purchase' },
    { ...payload, consent: false },
    { ...payload, eventData: { ...payload.eventData, products: [] } },
  ])('rejects untrusted purchases, denied consent and invalid content', async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.record).not.toHaveBeenCalled();
  });
  it('returns a safe error on queue failure', async () => {
    mocks.record.mockRejectedValue(new Error('secret-sentinel'));
    const response = await POST(request(payload));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('secret-sentinel');
  });
  it('rejects a source URL from another origin', async () => {
    expect(
      (
        await POST(
          request({ ...payload, eventSourceUrl: 'https://other.example/cart' })
        )
      ).status
    ).toBe(400);
    expect(mocks.record).not.toHaveBeenCalled();
  });
  it('handles malformed JSON', async () => {
    expect(
      (
        await POST(
          new NextRequest('https://ogabassey.com/api/analytics/snapchat', {
            method: 'POST',
            body: '{',
          })
        )
      ).status
    ).toBe(400);
  });
});

it('retains Snapchat attribution without copying TikTok identifiers into delivery', async () => {
  const response = await POST(
    new NextRequest('https://ogabassey.com/api/analytics/snapchat', {
      method: 'POST',
      headers: {
        host: 'ogabassey.com',
        'content-type': 'application/json',
        cookie: '_ttp=tiktok-cookie; ScCid=snap-click',
      },
      body: JSON.stringify({
        ...payload,
        eventSourceUrl: 'https://ogabassey.com/cart?ttclid=tiktok-click',
      }),
    })
  );
  expect(response.status).toBe(202);
  const event = mocks.record.mock.calls[0][1];
  expect(event.deliveryData).toMatchObject({
    marketing_consent: true,
    sccid: 'snap-click',
  });
  expect(event.deliveryData).not.toHaveProperty('ttclid');
  expect(event.deliveryData).not.toHaveProperty('ttp');
});
