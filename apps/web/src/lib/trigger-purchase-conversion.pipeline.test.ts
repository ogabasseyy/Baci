import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEventPipelineTestClient } from '@/lib/events/event-pipeline-test-client';

const mocks = vi.hoisted(() => ({
  enqueue: vi.fn(),
  send: vi.fn(),
}));

vi.mock('@/lib/events/enqueue-paid-order-domain-event', () => ({
  enqueuePaidOrderDomainEvent: (...args: unknown[]) => mocks.enqueue(...args),
}));

vi.mock('@/lib/analytics/analytics-platform-config', () => ({
  fetchAnalyticsPlatformConfig: vi.fn().mockResolvedValue({
    facebook_capi_token: 'token',
    facebook_pixel_id: 'pixel',
    offline_conversions_enabled: true,
  }),
  hasConfiguredAnalyticsPlatform: () => true,
}));

vi.mock('@/lib/offline-conversions', () => ({
  logConversionResults: vi.fn(),
  sendPurchaseConversion: (...args: unknown[]) => mocks.send(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { triggerPurchaseConversion } from '@/lib/trigger-purchase-conversion';

const order = {
  ad_tracking: { eventId: 'browser-event-1' },
  currency: 'NGN',
  id: 'order-1',
  order_items: [],
  total: 200_000,
};

const testClient = () =>
  createEventPipelineTestClient(
    vi.fn<typeof globalThis.fetch>(async () => Response.json([]))
  );

const pipelineEnvironmentKeys = [
  'EVENT_PIPELINE_ENQUEUE_ENABLED',
  'EVENT_PIPELINE_DELIVERY_ENABLED',
  'EVENT_PIPELINE_ROUTING_MODE',
  'EVENT_PIPELINE_DISABLE_LEGACY_FANOUT',
  'EVENT_PIPELINE_ACTIVE_DESTINATIONS',
  'EVENT_PIPELINE_CANARY_MERCHANT_IDS',
] as const;

let originalPipelineEnvironment: Record<string, string | undefined> = {};

describe('triggerPurchaseConversion pipeline migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-15T12:00:00.000Z'));
    originalPipelineEnvironment = Object.fromEntries(
      pipelineEnvironmentKeys.map((key) => [key, process.env[key]])
    );
    process.env.EVENT_PIPELINE_ENQUEUE_ENABLED = 'true';
    delete process.env.EVENT_PIPELINE_DELIVERY_ENABLED;
    delete process.env.EVENT_PIPELINE_ROUTING_MODE;
    delete process.env.EVENT_PIPELINE_DISABLE_LEGACY_FANOUT;
    delete process.env.EVENT_PIPELINE_ACTIVE_DESTINATIONS;
    delete process.env.EVENT_PIPELINE_CANARY_MERCHANT_IDS;
    mocks.enqueue.mockResolvedValue({
      already_enqueued: false,
      domain_event_id: '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a234',
      queue_message_id: 1,
    });
    mocks.send.mockResolvedValue([{ platform: 'facebook', success: true }]);
  });

  afterEach(() => {
    vi.useRealTimers();
    for (const key of pipelineEnvironmentKeys) {
      const originalValue = originalPipelineEnvironment[key];
      if (originalValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalValue;
      }
    }
  });

  it('can stop after the durable handoff without loading customer data', async () => {
    const supabase = testClient();

    await triggerPurchaseConversion(supabase, 'merchant-1', order, {
      deliveryMode: 'enqueue_only',
    });

    expect(mocks.enqueue).toHaveBeenCalledWith(supabase, {
      externalEventId: 'browser-event-1',
      merchantId: 'merchant-1',
      orderId: 'order-1',
    });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('forwards the paid occurrence time into the durable event', async () => {
    const paidAt = '2026-07-13T12:34:56.000Z';

    await triggerPurchaseConversion(
      testClient(),
      'merchant-1',
      { ...order, occurredAt: paidAt },
      { deliveryMode: 'enqueue_only' }
    );

    expect(mocks.enqueue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ occurredAt: paidAt })
    );
  });

  it('retains legacy delivery after enqueue before authority expiry', async () => {
    await triggerPurchaseConversion(testClient(), 'merchant-1', order);

    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it('keeps the durable handoff but stops legacy delivery after merchant authority expires', async () => {
    vi.setSystemTime(new Date('2026-09-27T12:00:00.000Z'));

    await triggerPurchaseConversion(testClient(), 'merchant-1', order);

    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('fails closed when the durable handoff fails', async () => {
    mocks.enqueue.mockRejectedValueOnce(new Error('queue unavailable'));

    await expect(
      triggerPurchaseConversion(testClient(), 'merchant-1', order)
    ).rejects.toThrow('queue unavailable');
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
