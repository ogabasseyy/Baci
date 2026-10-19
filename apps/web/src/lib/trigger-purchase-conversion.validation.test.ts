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
const client = () =>
  createEventPipelineTestClient(
    vi.fn<typeof globalThis.fetch>(async (input) =>
      Response.json(
        new URL(String(input)).pathname.endsWith('/merchant_feature_settings')
          ? null
          : config
      )
    )
  );

describe('triggerPurchaseConversion item validation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-15T12:00:00.000Z'));
    vi.clearAllMocks();
    delete process.env.EVENT_PIPELINE_ENQUEUE_ENABLED;
    mocks.send.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalPipelineFlag === undefined) {
      delete process.env.EVENT_PIPELINE_ENQUEUE_ENABLED;
    } else {
      process.env.EVENT_PIPELINE_ENQUEUE_ENABLED = originalPipelineFlag;
    }
  });

  it('omits invalid items and reports their fields', async () => {
    await triggerPurchaseConversion(client(), 'merchant-1', {
      currency: 'NGN',
      id: 'order-1',
      order_items: [{ name: '', price: 'bad', product_id: null, quantity: 0 }],
      total: 100,
    });
    expect(mocks.send).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ items: [] })
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        invalidFields: ['product_id', 'name', 'price', 'quantity'],
      })
    );
  });

  it('treats null money values as invalid', async () => {
    await triggerPurchaseConversion(client(), 'merchant-1', {
      id: 'order-1',
      order_items: [
        { name: 'Phone', price: null, product_id: 'product-1', quantity: 1 },
      ],
      total: 100,
    });
    expect(mocks.send).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ items: [] })
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ invalidFields: ['price'] })
    );
  });

  it('throws before provider delivery in strict mode', async () => {
    await expect(
      triggerPurchaseConversion(
        client(),
        'merchant-1',
        {
          id: 'order-1',
          order_items: [{ name: '', price: -1, product_id: null, quantity: 0 }],
          total: 100,
        },
        { failOnInvalidItem: true }
      )
    ).rejects.toThrow('Invalid order item for conversion tracking');
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
