import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EVENT_ROUTE_MERCHANT_ID,
  eventRouteRequest,
} from './route.test-support';

const mocks = vi.hoisted(() => ({ insert: vi.fn(), upsert: vi.fn() }));
vi.mock('@/lib/events/event-ingress-capability', () => ({
  createEventIngressClient: () => ({
    from: () => ({ insert: mocks.insert, upsert: mocks.upsert }),
  }),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/analytics/send-to-ad-platforms', () => ({
  isConversionEvent: () => false,
  normalizeEventType: (value: string) =>
    value === 'START_CHECKOUT' ? 'begin_checkout' : value,
}));
vi.mock('@/lib/events/event-pipeline-config', () => ({
  isEventPipelineEnqueueEnabled: () => false,
  isLegacyAnalyticsFanoutDisabled: () => false,
  isUnverifiedEventTelemetryEnabled: () => false,
}));

import { POST } from './route';

describe('POST /api/events legacy persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.insert.mockResolvedValue({ error: null });
    mocks.upsert.mockResolvedValue({ error: null });
  });

  it('inserts without event_id and omits it from the legacy response', async () => {
    const timestamp = new Date().toISOString();
    const response = await POST(
      eventRouteRequest({ page_url: 'https://example.com', timestamp })
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ success: true });
    expect(mocks.insert).toHaveBeenCalledWith({
      event_data: { page_url: 'https://example.com' },
      event_timestamp: timestamp,
      event_type: 'page_view',
      merchant_id: EVENT_ROUTE_MERCHANT_ID,
      source: 'web',
    });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('inserts an explicit event ID with only the ingress insert policy', async () => {
    const response = await POST(
      eventRouteRequest({ event_id: 'event-1', event_type: 'purchase' })
    );
    expect(response.status).toBe(200);
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ event_id: 'event-1' })
    );
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('acknowledges a duplicate on the event identity index', async () => {
    mocks.insert.mockResolvedValue({
      error: {
        code: '23505',
        message:
          'duplicate key value violates unique constraint "analytics_events_merchant_event_id_type_uidx"',
      },
    });
    const response = await POST(eventRouteRequest({ event_id: 'event-1' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      event_id: 'event-1',
    });
  });

  it.each([
    [
      '23505',
      'duplicate key value violates unique constraint "analytics_events_pkey"',
    ],
    ['42501', 'new row violates row-level security policy'],
  ])('returns safe 500 on other persistence failures (%s)', async (code, message) => {
    mocks.insert.mockResolvedValue({ error: { code, message } });
    const response = await POST(eventRouteRequest({ event_id: 'event-1' }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to store event' });
  });

  it('normalizes mobile event names before persistence', async () => {
    await POST(
      eventRouteRequest({ event_name: 'START_CHECKOUT', event_type: undefined })
    );
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: 'begin_checkout' })
    );
  });
});
