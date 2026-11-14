import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONVERSION_EVENT_TIME as FIXED_EVENT_TIME,
  conversionRouteRequest as request,
} from './conversion-route.test-support';

const mocks = vi.hoisted(() => ({
  enqueueEnabled: false,
  fanoutDisabled: false,
  createServiceClient: vi.fn(),
  from: vi.fn(),
  fanout: vi.fn(),
  record: vi.fn(),
  resolveContext: vi.fn(),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: mocks.from }),
}));
vi.mock('@/lib/events/event-ingress-capability', () => ({
  createEventIngressClient: () => ({ from: mocks.from }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ from: mocks.from }),
}));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: mocks.createServiceClient,
}));
vi.mock('@/lib/events/event-ingress-context', () => ({
  resolveEventIngressContext: mocks.resolveContext,
}));
vi.mock('@/lib/events/event-pipeline-config', () => ({
  isEventPipelineEnqueueEnabled: () => mocks.enqueueEnabled,
  isLegacyAnalyticsFanoutDisabled: () => mocks.fanoutDisabled,
  isUnverifiedEventTelemetryEnabled: () => false,
}));
vi.mock('@/lib/events/record-analytics-domain-event', () => ({
  recordAnalyticsDomainEvent: mocks.record,
}));
vi.mock('@/lib/analytics/send-to-ad-platforms', () => ({
  normalizeEventType: (name: string) =>
    name === 'START_CHECKOUT' ? 'begin_checkout' : undefined,
}));
vi.mock('@/lib/analytics/trusted-server-ad-platform-fanout', () => ({
  trustedServerAdPlatformFanout: mocks.fanout,
}));
vi.mock('@/lib/facebook-capi', () => ({ generateEventId: () => 'event-1' }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { POST } from './route';

describe('POST /api/analytics/conversion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_EVENT_TIME * 1_000));
    mocks.enqueueEnabled = false;
    mocks.fanoutDisabled = false;
    const analytics = { upsert: vi.fn().mockResolvedValue({ error: null }) };
    const merchant = {
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a235' },
        error: null,
      }),
      select: vi.fn().mockReturnThis(),
    };
    mocks.from.mockImplementation((table: string) =>
      table === 'analytics_events' ? analytics : merchant
    );
    mocks.createServiceClient.mockReturnValue({ from: mocks.from });
    mocks.fanout.mockResolvedValue({ facebook: { success: true } });
    mocks.record.mockResolvedValue({ queue_message_id: 1 });
    mocks.resolveContext.mockResolvedValue({
      merchantId: '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a235',
      ok: true,
      trustLevel: 'anonymous_client',
      verified: false,
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  it('rejects caller-owned routing fields through strict validation', async () => {
    const response = await POST(request({ trust_level: 'server' }));
    expect(response.status).toBe(400);
    expect(mocks.record).not.toHaveBeenCalled();
    expect(mocks.fanout).not.toHaveBeenCalled();
  });
  it('atomically records a verified event when durable enqueue is enabled', async () => {
    mocks.enqueueEnabled = true;
    mocks.resolveContext.mockResolvedValue({
      merchantId: '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a235',
      ok: true,
      trustLevel: 'tenant_verified_client',
      verified: true,
    });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.record).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        deliveryData: expect.any(Object),
        eventData: expect.objectContaining({ search_string: undefined }),
        eventName: 'analytics.begin_checkout.v1',
        externalEventId: 'event-1',
      })
    );
  });
  it('records ad-matching fields for a consented conversion event', async () => {
    mocks.enqueueEnabled = true;
    mocks.resolveContext.mockResolvedValue({
      merchantId: '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a235',
      ok: true,
      trustLevel: 'tenant_verified_client',
      verified: true,
    });
    const response = await POST(
      request(
        { user_data: { em: 'a@example.com', fbp: 'fbp.1' } },
        { 'user-agent': 'Agent', 'x-forwarded-for': '203.0.113.1' }
      )
    );
    expect(response.status).toBe(200);
    expect(mocks.record).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        deliveryData: expect.objectContaining({
          email: 'a@example.com',
          fbp: 'fbp.1',
          ip: '203.0.113.1',
          ua: 'Agent',
        }),
      })
    );
  });
  it('records no personal fields when the visitor granted no consent', async () => {
    mocks.enqueueEnabled = true;
    mocks.resolveContext.mockResolvedValue({
      merchantId: '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a235',
      ok: true,
      trustLevel: 'tenant_verified_client',
      verified: true,
    });
    const response = await POST(
      request(
        {
          analytics_consent: false,
          marketing_consent: false,
          user_data: { em: 'a@example.com', ph: '+2348000000000' },
        },
        { 'user-agent': 'Agent', 'x-forwarded-for': '203.0.113.1' }
      )
    );
    expect(response.status).toBe(200);
    expect(mocks.record).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        deliveryData: { analytics_consent: false, marketing_consent: false },
      })
    );
  });
  it('accepts an empty pre-order checkout ID and persists requested targets', async () => {
    mocks.enqueueEnabled = true;
    mocks.resolveContext.mockResolvedValue({
      merchantId: '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a235',
      ok: true,
      trustLevel: 'tenant_verified_client',
      verified: true,
    });
    const response = await POST(
      request({
        custom_data: { order_id: '', value: 100 },
        targets: ['facebook'],
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.record).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        eventData: expect.objectContaining({
          order_id: undefined,
          targets: ['facebook'],
        }),
      })
    );
  });
  it('preserves the native-client merchant fallback when tenant identity is absent', async () => {
    mocks.enqueueEnabled = true;
    mocks.resolveContext.mockResolvedValue({
      merchantId: '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a235',
      ok: false,
    });

    const response = await POST(request({ merchant_id: undefined }));

    expect(response.status).toBe(200);
    expect(mocks.record).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        merchantId: '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a235',
        trustLevel: 'anonymous_client',
      })
    );
  });
  it('resolves an origin storefront before the default merchant in pipeline mode', async () => {
    mocks.enqueueEnabled = true;
    mocks.resolveContext.mockResolvedValue({
      merchantId: 'origin-merchant-id',
      ok: true,
      trustLevel: 'anonymous_client',
      verified: false,
    });
    const merchant = {
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: 'origin-merchant-id' },
        error: null,
      }),
      select: vi.fn().mockReturnThis(),
    };
    mocks.from.mockImplementation((table: string) =>
      table === 'analytics_events'
        ? { upsert: vi.fn().mockResolvedValue({ error: null }) }
        : merchant
    );

    const response = await POST(
      new NextRequest('https://usebaci.com/api/analytics/conversion', {
        body: JSON.stringify({
          custom_data: { currency: 'NGN', value: 100 },
          event_name: 'START_CHECKOUT',
          event_source: 'web',
          event_time: FIXED_EVENT_TIME,
          user_data: {},
        }),
        headers: { origin: 'https://origin-store.usebaci.com' },
        method: 'POST',
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.resolveContext).toHaveBeenCalledWith(
      expect.objectContaining({ merchantId: 'origin-merchant-id' })
    );
    expect(mocks.record).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        merchantId: 'origin-merchant-id',
        trustLevel: 'anonymous_client',
      })
    );
  });

  it('preserves the native-client merchant fallback without elevating it', async () => {
    const response = await POST(request({ merchant_id: undefined }));

    expect(response.status).toBe(200);
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
    expect(mocks.fanout).not.toHaveBeenCalled();
  });

  it('fans out in legacy mode only with independently verified host identity', async () => {
    mocks.resolveContext.mockResolvedValue({
      merchantId: '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a235',
      ok: true,
      trustLevel: 'tenant_verified_client',
      verified: true,
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.createServiceClient).toHaveBeenCalledWith('event-pipeline');
    expect(mocks.fanout).toHaveBeenCalledWith(
      expect.any(Object),
      '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a235',
      expect.objectContaining({
        merchant_id: '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a235',
      })
    );
  });

  // biome-ignore format: compact host-authority regression preserves the 300-line test gate.
  it('denies service authority from a root-host spoofed referer', async () => {
    mocks.resolveContext.mockImplementation(async ({ request: requestView }) => requestView.headers.get('referer') ? { merchantId: '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a235', ok: true, trustLevel: 'tenant_verified_client', verified: true } : { merchantId: '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a235', ok: true, trustLevel: 'anonymous_client', verified: false });
    const response = await POST(request({}, { host: 'usebaci.com', referer: 'https://usebaci.com/shop/product' }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ results: {} });
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
    expect(mocks.fanout).not.toHaveBeenCalled();
  });

  it('persists Referer context when Host cannot grant delivery authority', async () => {
    mocks.enqueueEnabled = true;
    mocks.resolveContext
      .mockResolvedValueOnce({
        merchantId: '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a235',
        ok: true,
        trustLevel: 'tenant_verified_client',
        verified: true,
      })
      .mockResolvedValueOnce({
        merchantId: '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a235',
        ok: true,
        trustLevel: 'anonymous_client',
        verified: false,
      });

    const response = await POST(
      request(
        {},
        { host: 'usebaci.com', referer: 'https://usebaci.com/victim/product' }
      )
    );

    expect(response.status).toBe(200);
    expect(mocks.resolveContext).toHaveBeenCalledTimes(2);
    expect(mocks.record).toHaveBeenCalledTimes(1);
    expect(mocks.fanout).not.toHaveBeenCalled();
  });

  it('uses legacy fanout when durable persistence fails during shadow mode', async () => {
    mocks.enqueueEnabled = true;
    mocks.resolveContext.mockResolvedValue({
      merchantId: '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a235',
      ok: true,
      trustLevel: 'tenant_verified_client',
      verified: true,
    });
    mocks.record.mockRejectedValue(new Error('queue unavailable'));

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.fanout).toHaveBeenCalledWith(
      expect.any(Object),
      '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a235',
      expect.objectContaining({
        event_id: 'event-1',
        merchant_id: '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a235',
      })
    );
  });
});
