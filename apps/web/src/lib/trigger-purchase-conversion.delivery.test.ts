import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEventPipelineTestClient } from '@/lib/events/event-pipeline-test-client';

const mocks = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('@/lib/offline-conversions', () => ({
  logConversionResults: vi.fn(),
  sendPurchaseConversion: mocks.send,
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { logger } from '@/lib/logger';
import { triggerPurchaseConversion } from './trigger-purchase-conversion';

const originalPipelineFlag = process.env.EVENT_PIPELINE_ENQUEUE_ENABLED;

const config = {
  facebook_capi_token: 'token',
  facebook_pixel_id: 'pixel',
  ga4_api_secret: null,
  google_analytics_id: null,
  offline_conversions_enabled: true,
  plan_expires_at: null,
  plan_tier: 'pro',
  premium_features: [],
  snapchat_capi_token: null,
  snapchat_pixel_id: null,
  tiktok_access_token: null,
  tiktok_pixel_id: null,
};

function client(data: unknown = config, error?: unknown) {
  return createEventPipelineTestClient(
    vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/merchant_feature_settings')) {
        return Response.json(null);
      }
      return error
        ? Response.json(error, { status: 500 })
        : Response.json(data);
    })
  );
}

const order = {
  currency: 'NGN',
  id: 'order-1',
  order_items: [
    { name: 'Phone', price: '200000', product_id: 'product-1', quantity: 1 },
  ],
  order_number: 'BAC-1',
  total: 200_000,
};

describe('triggerPurchaseConversion delivery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-15T12:00:00.000Z'));
    vi.clearAllMocks();
    delete process.env.EVENT_PIPELINE_ENQUEUE_ENABLED;
    mocks.send.mockResolvedValue([{ platform: 'facebook', success: true }]);
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalPipelineFlag === undefined) {
      delete process.env.EVENT_PIPELINE_ENQUEUE_ENABLED;
    } else {
      process.env.EVENT_PIPELINE_ENQUEUE_ENABLED = originalPipelineFlag;
    }
  });

  it('sends stable purchase identity and normalized items', async () => {
    await triggerPurchaseConversion(client(), 'merchant-1', order);
    expect(mocks.send).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        eventId: 'purchase_order-1',
        items: [
          { id: 'product-1', name: 'Phone', price: 200_000, quantity: 1 },
        ],
      })
    );
  });

  it('omits malformed browser tracking values', async () => {
    await triggerPurchaseConversion(client(), 'merchant-1', {
      ...order,
      ad_tracking: { fbc: 42, limitedDataUse: 'true' },
    });
    expect(mocks.send).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ fbc: undefined, limitedDataUse: undefined })
    );
  });

  it('skips disabled configuration', async () => {
    await triggerPurchaseConversion(
      client({ ...config, offline_conversions_enabled: false }),
      'merchant-1',
      order
    );
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('logs and rethrows provider failures', async () => {
    mocks.send.mockRejectedValue(new Error('capi failed'));
    await expect(
      triggerPurchaseConversion(client(), 'merchant-1', order)
    ).rejects.toThrow('capi failed');
    expect(logger.error).toHaveBeenCalled();
  });
});
