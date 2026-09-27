import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  legacyFanoutDisabled: true,
  record: vi.fn(),
  resolveContext: vi.fn(),
  insert: vi.fn(),
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
vi.mock('@/lib/events/event-pipeline-config', () => ({
  isEventPipelineEnqueueEnabled: () => true,
  isLegacyAnalyticsFanoutDisabled: () => mocks.legacyFanoutDisabled,
}));
vi.mock('@/lib/events/event-ingress-context', () => ({
  resolveEventIngressContext: mocks.resolveContext,
}));
vi.mock('@/lib/events/record-platform-domain-event', () => ({
  recordPlatformDomainEvent: mocks.record,
}));

import { POST } from './route';

describe('POST /api/platform/events durable pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.legacyFanoutDisabled = true;
    mocks.resolveContext.mockResolvedValue({
      merchantId: '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a235',
      ok: true,
      trustLevel: 'tenant_verified_client',
      verified: true,
    });
    mocks.from.mockImplementation((table: string) => {
      if (table === 'platform_events') return { insert: mocks.insert };
      if (table === 'platform_settings') {
        return {
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    });
  });

  it('falls back to legacy persistence when durable enqueue fails during shadow mode', async () => {
    mocks.legacyFanoutDisabled = false;
    mocks.record.mockRejectedValueOnce(new Error('queue unavailable'));
    mocks.insert.mockResolvedValueOnce({ error: null });

    const response = await POST(
      new NextRequest('https://usebaci.com/api/platform/events', {
        body: JSON.stringify({
          event_id: 'platform-event-1',
          event_type: 'landing_page_view',
        }),
        method: 'POST',
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        event_id: 'platform-event-1',
        event_type: 'landing_page_view',
      })
    );
  });

  it('routes allowlisted low-risk public telemetry without elevating trust', async () => {
    mocks.record.mockResolvedValue({ queue_message_id: 1 });
    const response = await POST(
      new NextRequest('https://usebaci.com/api/platform/events', {
        body: JSON.stringify({
          event_type: 'landing_page_view',
          page_url: 'https://usebaci.com/',
        }),
        method: 'POST',
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.event_id).toMatch(/^platform_/);
    expect(mocks.record).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        eventName: 'platform.landing_page_view.v1',
        trustLevel: 'anonymous_client',
      })
    );
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('does not forward client conversion claims after the legacy fanout cutover', async () => {
    mocks.record.mockResolvedValue({ queue_message_id: 1 });

    const response = await POST(
      new NextRequest('https://usebaci.com/api/platform/events', {
        body: JSON.stringify({
          event_type: 'platform_purchase',
          event_data: { value: 10_000 },
        }),
        method: 'POST',
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.record).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ eventName: 'platform.client.observed.v1' })
    );
    expect(mocks.from).not.toHaveBeenCalledWith('platform_settings');
  });

  it('uses the validated page URL to resolve a merchant ingress context', async () => {
    mocks.record.mockResolvedValue({ queue_message_id: 1 });
    const request = new NextRequest('https://usebaci.com/api/platform/events', {
      body: JSON.stringify({
        event_type: 'landing_page_view',
        merchant_id: '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a235',
        page_url: 'https://usebaci.com/shop/products',
      }),
      method: 'POST',
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mocks.resolveContext).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a235',
        pageUrl: 'https://usebaci.com/shop/products',
      })
    );
  });
});
