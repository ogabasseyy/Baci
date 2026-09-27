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

function client(currency: unknown) {
  return createEventPipelineTestClient(
    vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/merchant_feature_settings')) {
        return Response.json(null);
      }
      return Response.json(
        url.searchParams.get('select')?.includes('payout_currency')
          ? currency
          : config
      );
    })
  );
}

describe('triggerPurchaseConversion currency', () => {
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

  it.each([
    ['GHS', null, 'GHS'],
    [null, { country: 'GH', payout_currency: 'GHS' }, 'GHS'],
    [undefined, null, 'NGN'],
  ])('resolves currency precedence', async (orderCurrency, merchant, expected) => {
    await triggerPurchaseConversion(client(merchant), 'merchant-1', {
      currency: orderCurrency,
      id: 'order-1',
      order_items: [],
      total: 100,
    });
    expect(mocks.send).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ currency: expected })
    );
  });
});
