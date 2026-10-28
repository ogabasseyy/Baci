import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eventRouteRequest } from './route.test-support';

const mocks = vi.hoisted(() => ({ upsert: vi.fn() }));
vi.mock('@/lib/events/event-ingress-capability', () => ({
  createEventIngressClient: () => ({
    from: () => ({ insert: vi.fn(), upsert: mocks.upsert }),
  }),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/analytics/send-to-ad-platforms', () => ({
  isConversionEvent: () => false,
  normalizeEventType: (value: string) => value,
}));
vi.mock('@/lib/events/event-pipeline-config', () => ({
  isEventPipelineEnqueueEnabled: () => false,
  isLegacyAnalyticsFanoutDisabled: () => false,
  isUnverifiedEventTelemetryEnabled: () => false,
}));

import { POST } from './route';

describe('POST /api/events event data', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.upsert.mockResolvedValue({ error: null });
  });

  it.each([
    [
      {
        event_type: 'product_view',
        product_id: 'sku-1',
        product_name: 'Phone',
        product_price: 100,
      },
      { product_id: 'sku-1', product_name: 'Phone', product_price: 100 },
    ],
    [
      { event_type: 'search', results_count: 2, search_term: 'phone' },
      { results_count: 2, search_term: 'phone' },
    ],
    [
      {
        event_type: 'page_view',
        page_url: 'https://shop.usebaci.com/p',
        referrer: 'https://google.com',
      },
      {
        page_url: 'https://shop.usebaci.com/p',
        referrer: 'https://google.com',
      },
    ],
  ])('builds event-specific data', async (input, eventData) => {
    await POST(eventRouteRequest({ ...input, event_id: 'event-1' }));
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        event_data: {
          ...eventData,
          ...(input.event_type === 'product_view' ||
          input.event_type === 'search'
            ? { targets: [] }
            : {}),
        },
      }),
      expect.any(Object)
    );
  });

  it('uses nested custom_data for unknown event types', async () => {
    await POST(
      eventRouteRequest({
        custom_data: { answer: 42 },
        event_id: 'event-1',
        event_type: 'custom_event',
      })
    );
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ event_data: { custom_data: { answer: 42 } } }),
      expect.any(Object)
    );
  });

  it('removes undefined values from persisted event data', async () => {
    await POST(
      eventRouteRequest({
        event_id: 'event-1',
        event_type: 'product_view',
        product_id: 'sku-1',
      })
    );
    const row = mocks.upsert.mock.calls[0]?.[0];
    expect(row.event_data).toEqual({
      product_id: 'sku-1',
      targets: [],
    });
    expect(Object.values(row.event_data)).not.toContain(undefined);
  });
});
