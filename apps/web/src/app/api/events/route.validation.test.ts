import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eventRouteRequest } from './route.test-support';

const mocks = vi.hoisted(() => ({ insert: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/events/event-ingress-capability', () => ({
  createEventIngressClient: () => ({ from: mocks.from }),
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

describe('POST /api/events validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.insert.mockResolvedValue({ error: null });
    mocks.from.mockReturnValue({ insert: mocks.insert, upsert: vi.fn() });
  });

  it.each([
    [{}, 'Missing required fields: event_type and merchant_id'],
    [
      { event_type: 'page_view' },
      'Missing required fields: event_type and merchant_id',
    ],
    [
      { merchant_id: '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a235' },
      'Missing required fields: event_type and merchant_id',
    ],
  ])('rejects missing required fields', async (body, error) => {
    const response = await POST(
      new NextRequest('https://shop.usebaci.com/api/events', {
        body: JSON.stringify(body),
        method: 'POST',
      })
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error });
  });

  it('uses the stable schema-error contract', async () => {
    const response = await POST(eventRouteRequest({ page_url: 'not-a-url' }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: 'invalid_input',
      error: 'Invalid input',
    });
  });

  it('rejects invalid JSON', async () => {
    const response = await POST(
      new NextRequest('https://shop.usebaci.com/api/events', {
        body: 'invalid json',
        method: 'POST',
      })
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON' });
  });
});
