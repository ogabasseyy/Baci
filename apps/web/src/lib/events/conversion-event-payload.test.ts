import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { conversionEventPayload } from './conversion-event-payload';

describe('conversionEventPayload', () => {
  it('uses the trusted shopper address and preserves provider matching data', () => {
    const request = new NextRequest('https://usebaci.com/api/events', {
      headers: {
        'user-agent': 'test-agent',
        'x-forwarded-for': '203.0.113.1',
      },
    });
    const payload = conversionEventPayload.deliveryData(
      {
        custom_data: { value: 100 },
        event_name: 'PURCHASE',
        event_source: 'web',
        event_time: 1_784_937_600,
        user_data: { em: 'buyer@example.com', fbp: 'fb.1.123' },
      },
      request
    );

    expect(payload).toMatchObject({
      email: 'buyer@example.com',
      fbp: 'fb.1.123',
      ip: '203.0.113.1',
      ua: 'test-agent',
    });
  });

  it('keeps targets and commerce details in the stored event payload', () => {
    expect(
      conversionEventPayload.toStoredEventData({
        custom_data: {
          contents: [{ id: 'sku-1', quantity: 2 }],
          currency: 'GHS',
          order_id: 'order-1',
          value: 200,
        },
        event_name: 'PURCHASE',
        event_source: 'web',
        event_time: 1_784_937_600,
        targets: ['facebook'],
        analytics_consent: true,
        user_data: {},
      })
    ).toEqual({
      currency: 'GHS',
      item_count: 1,
      items: [{ id: 'sku-1', quantity: 2 }],
      order_id: 'order-1',
      search_string: undefined,
      targets: ['facebook'],
      total: 200,
    });
  });

  describe('bugfix: ad platforms received the Cloudflare egress address', () => {
    afterEach(() => vi.unstubAllEnvs());

    it('forwards the verified visitor address, not the Cloudflare peer', () => {
      vi.stubEnv('VERCEL', '1');
      const request = new NextRequest('https://usebaci.com/api/events', {
        headers: {
          'cf-connecting-ip': '203.0.113.9',
          'cf-ray': 'a509c917eae1b920-AMS',
          'x-forwarded-for': '172.68.1.20',
          'x-real-ip': '172.68.1.20',
        },
      });
      const payload = conversionEventPayload.deliveryData(
        {
          custom_data: { value: 100 },
          event_name: 'PURCHASE',
          event_source: 'web',
          event_time: 1_784_937_600,
          user_data: {},
        },
        request
      );

      expect(payload.ip).toBe('203.0.113.9');
    });
  });
});
