import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mock setup ---

const mockInsert = vi.fn();
const mockSettingsSingle = vi.fn();
const mockCreateAdminClient = vi.fn(() => ({ from: mockFrom }));
const mockFrom = vi.fn((table: string) => {
  if (table === 'platform_events') {
    return { insert: mockInsert };
  }
  if (table === 'platform_settings') {
    return {
      select: vi.fn().mockReturnThis(),
      single: mockSettingsSingle,
    };
  }
  throw new Error(`Unexpected table: ${table}`);
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ from: mockFrom })),
}));

vi.mock('@/lib/events/event-ingress-capability', () => ({
  createEventIngressClient: vi.fn(() => ({ from: mockFrom })),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({ from: mockFrom })),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mockCreateAdminClient,
}));

const mockSendGA4Event = vi.fn();
vi.mock('@/lib/ga4-measurement-protocol', () => ({
  sendGA4Event: (...args: unknown[]) => mockSendGA4Event(...args),
  generateClientId: () => 'client-1',
}));

const mockSendFacebookCAPIEvent = vi.fn();
vi.mock('@/lib/facebook-capi', () => ({
  sendFacebookCAPIEvent: (...args: unknown[]) =>
    mockSendFacebookCAPIEvent(...args),
}));

import { POST } from './route';

const MERCHANT_ID = '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a235';

// --- Helpers ---

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/platform/events', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/platform/events', () => {
  it('acknowledges an already-stored event without provider forwarding', async () => {
    mockInsert.mockResolvedValueOnce({
      error: {
        code: '23505',
        message:
          'duplicate key value violates unique constraint "platform_events_type_event_id_uidx"',
      },
    });
    const response = await POST(
      makeRequest({ event_type: 'landing_page_view', event_id: 'retry-1' })
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      event_id: 'retry-1',
      success: true,
    });
    expect(mockSettingsSingle).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-29T12:00:00.000Z'));
    vi.clearAllMocks();
    delete process.env.EVENT_PIPELINE_ENQUEUE_ENABLED;
    delete process.env.EVENT_PIPELINE_DISABLE_LEGACY_FANOUT;
    mockInsert.mockResolvedValue({ data: null, error: null });
    mockSettingsSingle.mockResolvedValue({
      data: {
        google_analytics_id: 'G-TEST',
        ga4_api_secret: 'secret',
        facebook_pixel_id: 'pixel',
        facebook_capi_token: 'token',
      },
      error: null,
    });
    mockSendGA4Event.mockResolvedValue(undefined);
    mockSendFacebookCAPIEvent.mockResolvedValue(undefined);
  });
  afterEach(() => vi.useRealTimers());

  it('returns 400 for an unknown event_type', async () => {
    const res = await POST(makeRequest({ event_type: 'not_a_real_event' }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Invalid input');
  });

  it('returns 400 for invalid JSON', async () => {
    const res = await POST(
      new NextRequest('http://localhost/api/platform/events', {
        body: '{',
        method: 'POST',
      })
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid JSON' });
  });

  it('returns 400 for a malformed currency code', async () => {
    const res = await POST(
      makeRequest({
        event_type: 'platform_purchase',
        merchant_id: MERCHANT_ID,
        event_data: { value: 1000, currency: 'NAIRA' },
      })
    );

    expect(res.status).toBe(400);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('inserts the event and returns success for a valid page view', async () => {
    const res = await POST(
      makeRequest({
        event_id: 'platform-event-1',
        event_type: 'landing_page_view',
        page_url: 'https://usebaci.com',
        session_id: 'ps_1',
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        event_id: 'platform-event-1',
        event_type: 'landing_page_view',
      })
    );
  });

  it('acknowledges an idempotent platform event retry', async () => {
    const request = {
      event_id: 'platform-event-retry',
      event_type: 'landing_page_view',
    };

    const first = await POST(makeRequest(request));
    const retry = await POST(makeRequest(request));

    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(mockInsert).toHaveBeenCalledTimes(2);
  });

  it.each([
    undefined,
    'true',
    'false',
  ])('never reads platform settings or forwards providers when legacy flag is %s', async (legacyFlag) => {
    if (legacyFlag === undefined) {
      delete process.env.EVENT_PIPELINE_DISABLE_LEGACY_FANOUT;
    } else {
      process.env.EVENT_PIPELINE_DISABLE_LEGACY_FANOUT = legacyFlag;
    }

    const response = await POST(
      makeRequest({
        event_type: 'platform_purchase',
        event_data: { value: 5000 },
      })
    );

    expect(response.status).toBe(200);
    expect(mockInsert).toHaveBeenCalled();
    expect(mockSettingsSingle).not.toHaveBeenCalled();
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
    expect(mockSendGA4Event).not.toHaveBeenCalled();
    expect(mockSendFacebookCAPIEvent).not.toHaveBeenCalled();
  });
});
