import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/env', () => ({ getAppUrl: () => 'http://localhost:3000' }));

import {
  sendServerSideAnalytics,
  trackServerSideBeginCheckout,
  trackServerSidePurchase,
} from './server-side-analytics';

const merchantId = '11111111-1111-4111-8111-111111111111';
const products = [{ id: 'phone', name: 'Phone', price: 100, quantity: 2 }];
const user = { email: 'buyer@example.com', externalId: 'buyer-one' };
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      analytics: true,
      marketing: true,
      functional: true,
    })
  );
  fetcher = vi.fn().mockImplementation((url: string) =>
    Promise.resolve({
      ok: true,
      json: async () =>
        url.includes('ga4') ? { success: true } : { queued: true, sent: false },
    })
  );
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});
describe('browser observation compatibility', () => {
  it('preserves tenant, currency and products while reporting queue acceptance separately', async () => {
    const results = await trackServerSideBeginCheckout(
      merchantId,
      200,
      'NGN',
      products,
      user
    );
    expect(fetcher).toHaveBeenCalledTimes(4);
    for (const platform of ['Facebook', 'TikTok', 'Snapchat'])
      expect(results.find((r) => r.platform === platform)).toMatchObject({
        success: true,
        queued: true,
        sent: false,
      });
    expect(results.find((r) => r.platform === 'GA4')).toMatchObject({
      success: true,
      sent: true,
    });
    for (const [url, options] of fetcher.mock.calls) {
      const body = JSON.parse(options.body);
      expect(body).toMatchObject({
        merchantId,
        eventData: { currency: 'NGN', value: 200, products },
      });
      if (url.includes('tiktok') || url.includes('snapchat')) {
        expect(body.consent).toBe(true);
        expect(body.event).toBe('begin_checkout');
        expect(body.userData).toBeUndefined();
      }
    }
  });
  it('does not read visitor consent from a server context or send social observations', async () => {
    vi.stubGlobal('window', undefined);
    const results = await sendServerSideAnalytics(
      merchantId,
      'view_item',
      user,
      { value: 200, currency: 'NGN', products }
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe(
      'http://localhost:3000/api/analytics/ga4'
    );
    for (const platform of ['Facebook', 'TikTok', 'Snapchat'])
      expect(results.find((r) => r.platform === platform)).toMatchObject({
        sent: false,
        error: 'consent_required',
      });
  });
  it('does not send TikTok or Snapchat after marketing is denied even when analytics is allowed', async () => {
    localStorage.setItem(
      'baci-cookie-consent',
      JSON.stringify({
        necessary: true,
        analytics: true,
        marketing: false,
        functional: true,
      })
    );
    await trackServerSideBeginCheckout(merchantId, 200, 'NGN', products);
    expect(
      fetcher.mock.calls.some(
        ([url]) => url.includes('tiktok') || url.includes('snapchat')
      )
    ).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('does not post Meta observations without analytics consent', async () => {
    localStorage.clear();
    await trackServerSideBeginCheckout(merchantId, 200, 'NGN', products);
    expect(
      fetcher.mock.calls.some(([url]) => url.includes('facebook-capi'))
    ).toBe(false);
  });
  it('does not duplicate social checkout observations already owned by trackEvent', async () => {
    await trackServerSideBeginCheckout(
      merchantId,
      200,
      'NGN',
      products,
      {},
      { socialAlreadyQueued: true }
    );
    expect(
      fetcher.mock.calls.some(
        ([url]) => url.includes('tiktok') || url.includes('snapchat')
      )
    ).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('refuses client purchase claims before any platform request', async () => {
    const results = await trackServerSidePurchase(
      merchantId,
      'order-one',
      200,
      'NGN',
      products,
      user
    );
    expect(fetcher).not.toHaveBeenCalled();
    for (const platform of ['GA4', 'Facebook', 'TikTok', 'Snapchat'])
      expect(results.find((r) => r.platform === platform)).toMatchObject({
        success: false,
        sent: false,
        error: 'untrusted_purchase',
      });
  });
  it('also refuses direct generic purchase calls without fetching any endpoint', async () => {
    const results = await sendServerSideAnalytics(
      merchantId,
      'purchase',
      user,
      { value: 200, currency: 'NGN', products, transactionId: 'order-one' },
      { socialAlreadyQueued: true }
    );
    expect(fetcher).not.toHaveBeenCalled();
    expect(results).toHaveLength(4);
    expect(
      results.every(
        (result) => result.error === 'untrusted_purchase' && !result.sent
      )
    ).toBe(true);
  });
  it('does not report provider delivery when ingress rejects a request', async () => {
    fetcher.mockImplementation((url: string) =>
      Promise.resolve({
        ok: !url.includes('tiktok'),
        json: async () => ({ queued: true, sent: false }),
      })
    );
    const results = await trackServerSideBeginCheckout(
      merchantId,
      200,
      'NGN',
      products
    );
    expect(results.find((r) => r.platform === 'TikTok')).toMatchObject({
      success: false,
      queued: false,
      sent: false,
    });
    expect(results.find((r) => r.platform === 'Snapchat')).toMatchObject({
      success: true,
      queued: true,
      sent: false,
    });
  });
  it('handles network failures without disrupting checkout or returning raw social provider errors', async () => {
    fetcher.mockRejectedValue(new Error('provider-private-sentinel'));
    const results = await trackServerSideBeginCheckout(
      merchantId,
      200,
      'NGN',
      products
    );
    expect(results).toHaveLength(4);
    for (const platform of ['TikTok', 'Snapchat'])
      expect(results.find((r) => r.platform === platform)).toMatchObject({
        success: false,
        sent: false,
        error: 'event_queue_unavailable',
      });
  });
});
