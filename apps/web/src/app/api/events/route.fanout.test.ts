import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEventPipelineTestClient } from '@/lib/events/event-pipeline-test-client';
import {
  EVENT_ROUTE_MERCHANT_ID,
  eventRouteRequest,
} from './route.test-support';

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  build: vi.fn(),
  createServerClient: vi.fn(),
  createServiceClient: vi.fn(),
  fanout: vi.fn(),
  insert: vi.fn(),
  legacyFanoutDisabled: vi.fn(),
  loggerError: vi.fn(),
}));
vi.mock('next/server', async () => {
  const actual =
    await vi.importActual<typeof import('next/server')>('next/server');
  return { ...actual, after: mocks.after };
});
vi.mock('@/lib/events/event-ingress-capability', () => ({
  createEventIngressClient: () => ({
    from: () => ({ insert: mocks.insert, upsert: mocks.insert }),
  }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createServerClient,
}));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: mocks.createServiceClient,
}));
vi.mock('@/lib/analytics/trusted-server-ad-platform-fanout', () => ({
  trustedServerAdPlatformFanout: mocks.fanout,
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: mocks.loggerError, info: vi.fn(), warn: vi.fn() },
}));
vi.mock('@/lib/analytics/send-to-ad-platforms', () => ({
  isConversionEvent: (value: string) => value === 'purchase',
  normalizeEventType: (value: string) => value,
}));
vi.mock('@/lib/events/event-pipeline-config', () => ({
  isEventPipelineEnqueueEnabled: () => false,
  isLegacyAnalyticsFanoutDisabled: mocks.legacyFanoutDisabled,
  isUnverifiedEventTelemetryEnabled: () => false,
}));
vi.mock('./build-legacy-ad-platform-fanout-event', () => ({
  buildLegacyAdPlatformFanoutEvent: mocks.build,
}));

import { POST } from './route';

function lookupClient(result: { id: string } | null) {
  return createEventPipelineTestClient(
    vi.fn<typeof globalThis.fetch>(async () => Response.json(result))
  );
}

describe('POST /api/events fanout authority', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.insert.mockResolvedValue({ error: null });
    mocks.after.mockImplementation((callback) => callback());
    mocks.legacyFanoutDisabled.mockReturnValue(false);
    mocks.createServerClient.mockResolvedValue(
      lookupClient({ id: EVENT_ROUTE_MERCHANT_ID })
    );
    mocks.createServiceClient.mockReturnValue({ authority: 'service' });
    mocks.fanout.mockResolvedValue({});
    mocks.build.mockReturnValue({
      custom_data: {},
      event_id: 'event-1',
      event_type: 'purchase',
      analytics_consent: true,
      marketing_consent: true,
      merchant_id: EVENT_ROUTE_MERCHANT_ID,
      source: 'web',
      user_data: {},
    });
  });

  it('schedules conversion fanout with independently resolved identity', async () => {
    const response = await POST(
      eventRouteRequest({
        event_id: 'event-1',
        event_type: 'purchase',
        analytics_consent: true,
        marketing_consent: true,
        order_id: 'order-1',
        total: 100,
      })
    );
    expect(response.status).toBe(200);
    expect(mocks.build).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'event-1',
        resolvedMerchantId: EVENT_ROUTE_MERCHANT_ID,
      })
    );
    expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(mocks.createServiceClient).toHaveBeenCalledWith('event-pipeline');
  });

  it('preserves persistence and response while skipping mismatched authority', async () => {
    mocks.createServerClient.mockResolvedValue(
      lookupClient({ id: 'different-merchant' })
    );
    const response = await POST(
      eventRouteRequest({
        event_type: 'purchase',
        analytics_consent: true,
        marketing_consent: true,
        total: 100,
      })
    );
    expect(response.status).toBe(200);
    expect(mocks.insert).toHaveBeenCalled();
    expect(mocks.build).not.toHaveBeenCalled();
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
  });

  it('does not resolve tenant context for non-conversion page_view', async () => {
    const response = await POST(eventRouteRequest());
    expect(response.status).toBe(200);
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it.each([
    [
      'page URL',
      { page_url: `https://usebaci.com/${EVENT_ROUTE_MERCHANT_ID}/product` },
      { host: 'usebaci.com' },
    ],
    [
      'referer',
      {},
      {
        host: 'usebaci.com',
        referer: `https://usebaci.com/${EVENT_ROUTE_MERCHANT_ID}/product`,
      },
    ],
  ])('does not construct service authority from a spoofed root-host %s', async (_name, payload, headers) => {
    const response = await POST(
      eventRouteRequest(
        {
          event_type: 'purchase',
          analytics_consent: true,
          marketing_consent: true,
          total: 100,
          ...payload,
        },
        headers
      )
    );
    expect(response.status).toBe(200);
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
    expect(mocks.fanout).not.toHaveBeenCalled();
  });

  it('generates a stable-shaped fanout event id when absent', async () => {
    await POST(
      eventRouteRequest({
        event_type: 'purchase',
        analytics_consent: true,
        marketing_consent: true,
      })
    );
    expect(mocks.build).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: expect.stringMatching(/^evt_\d+_[0-9a-f]{32}$/),
      })
    );
  });

  it('does not log credential-bearing fanout exceptions', async () => {
    const sentinel = 'merchant-provider-credential-sentinel';
    mocks.fanout.mockRejectedValue(
      new Error(`provider credential=${sentinel}`)
    );

    const response = await POST(
      eventRouteRequest({
        event_type: 'purchase',
        analytics_consent: true,
        marketing_consent: true,
        total: 100,
      })
    );

    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(mocks.loggerError).toHaveBeenCalled());
    expect(JSON.stringify(mocks.loggerError.mock.calls)).not.toContain(
      sentinel
    );
    expect(mocks.loggerError).toHaveBeenLastCalledWith({
      message: 'CAPI fan-out error after response',
    });
  });

  it('rechecks authority revocation before deferred client construction', async () => {
    const deferred: Array<() => Promise<void>> = [];
    mocks.after.mockImplementation((callback: () => Promise<void>) => {
      deferred.push(callback);
    });

    const response = await POST(
      eventRouteRequest({
        event_type: 'purchase',
        analytics_consent: true,
        marketing_consent: true,
        total: 100,
      })
    );
    expect(response.status).toBe(200);
    expect(deferred).toHaveLength(1);
    expect(mocks.createServiceClient).not.toHaveBeenCalled();

    mocks.legacyFanoutDisabled.mockReturnValue(true);
    await deferred[0]?.();

    expect(mocks.createServiceClient).not.toHaveBeenCalled();
    expect(mocks.fanout).not.toHaveBeenCalled();
  });
});
