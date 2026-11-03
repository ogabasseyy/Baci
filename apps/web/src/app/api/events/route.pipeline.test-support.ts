import { NextRequest } from 'next/server';
import { vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  afterCallbacks: [] as Array<() => Promise<void>>,
  createServiceClient: vi.fn(),
  createServerClient: vi.fn(),
  fanout: vi.fn(),
  insert: vi.fn(),
  isConversionEvent: vi.fn(),
  isLegacyFanoutDisabled: vi.fn(),
  isPipelineEnabled: vi.fn(),
  record: vi.fn(),
  resolveContext: vi.fn(),
  rpc: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({ insert: mocks.insert, upsert: mocks.upsert }),
    rpc: mocks.rpc,
  }),
}));
vi.mock('@/lib/events/event-ingress-capability', () => ({
  createEventIngressClient: () => ({
    from: () => ({ insert: mocks.insert, upsert: mocks.upsert }),
    rpc: mocks.rpc,
  }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createServerClient,
}));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: mocks.createServiceClient,
}));
vi.mock('next/server', async () => {
  const actual =
    await vi.importActual<typeof import('next/server')>('next/server');
  return { ...actual, after: mocks.after };
});
vi.mock('@/lib/analytics/send-to-ad-platforms', () => ({
  isConversionEvent: mocks.isConversionEvent,
  normalizeEventType: (name: string) => name,
}));
vi.mock('@/lib/analytics/trusted-server-ad-platform-fanout', () => ({
  trustedServerAdPlatformFanout: mocks.fanout,
}));
vi.mock('@/lib/events/event-pipeline-config', () => ({
  isEventPipelineEnqueueEnabled: mocks.isPipelineEnabled,
  isLegacyAnalyticsFanoutDisabled: mocks.isLegacyFanoutDisabled,
  isUnverifiedEventTelemetryEnabled: () => false,
}));
vi.mock('@/lib/events/event-ingress-context', () => ({
  resolveEventIngressContext: mocks.resolveContext,
}));
vi.mock('@/lib/events/record-analytics-domain-event', () => ({
  recordAnalyticsDomainEvent: mocks.record,
}));

export const { POST } = await import('./route');

export const MERCHANT_ID = '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a235';
export const OTHER_MERCHANT_ID = '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a236';

export function request(
  merchantId = MERCHANT_ID,
  consent = true,
  eventType = 'page_view'
) {
  return new NextRequest('https://shop.usebaci.com/api/events', {
    body: JSON.stringify({
      event_type: eventType,
      analytics_consent: consent,
      marketing_consent: consent,
      merchant_id: merchantId,
      page_url: 'https://shop.usebaci.com/products?customer=private',
    }),
    headers: {
      cookie: '_fbc=fb.1.click; _fbp=fbp.1; _ttp=ttp.1; ScCid=snap.1',
      host: 'shop.usebaci.com',
      'user-agent': 'Baci test agent',
      'x-forwarded-for': '203.0.113.1',
      'x-merchant-slug': 'shop',
    },
    method: 'POST',
  });
}

export function resetPipelineMocks() {
  vi.clearAllMocks();
  mocks.afterCallbacks.length = 0;
  mocks.after.mockImplementation((callback: () => Promise<void>) => {
    mocks.afterCallbacks.push(callback);
  });
  mocks.insert.mockResolvedValue({ error: null });
  mocks.upsert.mockResolvedValue({ error: null });
  mocks.isConversionEvent.mockReturnValue(false);
  mocks.isLegacyFanoutDisabled.mockReturnValue(false);
  mocks.isPipelineEnabled.mockReturnValue(true);
  mocks.record.mockResolvedValue({ queue_message_id: 1 });
  mocks.createServerClient.mockResolvedValue({
    from: () => ({ insert: mocks.insert, upsert: mocks.upsert }),
    rpc: mocks.rpc,
  });
  mocks.createServiceClient.mockReturnValue({ from: vi.fn() });
  mocks.fanout.mockResolvedValue({ facebook: { success: true } });
}

export { mocks };
