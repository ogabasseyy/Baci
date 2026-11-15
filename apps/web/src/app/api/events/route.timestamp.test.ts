import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eventRouteRequest } from './route.test-support';

const mocks = vi.hoisted(() => ({ insert: vi.fn() }));
vi.mock('@/lib/events/event-ingress-capability', () => ({
  createEventIngressClient: () => ({
    from: () => ({ insert: mocks.insert }),
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

describe('POST /api/events source and timestamp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.insert.mockResolvedValue({ error: null });
  });

  it.each([
    ['mobile_app', 'mobile_app'],
    [undefined, 'web'],
  ])('persists source %s as %s', async (source, expected) => {
    await POST(eventRouteRequest({ event_id: 'event-1', source }));
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ source: expected })
    );
  });

  it('uses a supplied timestamp', async () => {
    const timestamp = new Date().toISOString();
    await POST(eventRouteRequest({ event_id: 'event-1', timestamp }));
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ event_timestamp: timestamp })
    );
  });

  it('generates a timestamp when absent', async () => {
    await POST(eventRouteRequest({ event_id: 'event-1' }));
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ event_timestamp: expect.any(String) })
    );
  });
});
