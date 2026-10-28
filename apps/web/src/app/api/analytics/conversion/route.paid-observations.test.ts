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
vi.mock(
  '@/lib/analytics/send-to-ad-platforms',
  async () => import('@/lib/analytics/normalize-ad-platform-event-type')
);
vi.mock('@/lib/analytics/trusted-server-ad-platform-fanout', () => ({
  trustedServerAdPlatformFanout: mocks.fanout,
}));
vi.mock('@/lib/facebook-capi', () => ({ generateEventId: () => 'event-1' }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { POST } from './route';

describe('POST /api/analytics/conversion paid observation boundary', () => {
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
  it.each([
    ['purchase', 'analytics.purchase.observed.v1'],
    ['PURCHASE', 'analytics.purchase.observed.v1'],
    ['place_order', 'analytics.client.observed.v1'],
    ['PLACE_AN_ORDER', 'analytics.client.observed.v1'],
  ])('accepts host-verified %s only as telemetry even with legacy fanout enabled', async (eventName, observedName) => {
    mocks.enqueueEnabled = true;
    mocks.fanoutDisabled = false;
    mocks.resolveContext.mockResolvedValue({
      merchantId: '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a235',
      ok: true,
      trustLevel: 'tenant_verified_client',
      verified: true,
    });
    const response = await POST(
      request({
        event_name: eventName,
        analytics_consent: true,
        marketing_consent: true,
      })
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      results: {},
    });
    expect(mocks.record).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        eventName: observedName,
        trustLevel: 'tenant_verified_client',
        deliveryData: expect.objectContaining({
          analytics_consent: true,
          marketing_consent: true,
        }),
      })
    );
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
    expect(mocks.fanout).not.toHaveBeenCalled();
  });
});
