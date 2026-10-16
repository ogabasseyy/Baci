import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/env', async (importOriginal) => {
  const mod = await importOriginal<EnvModule>();
  return { ...mod, getAppUrl: vi.fn(() => 'http://localhost:3000') };
});

import {
  sendServerSideAnalytics,
  trackServerSideBeginCheckout,
  trackServerSidePurchase,
} from './server-side-analytics';
import { serverSideAnalyticsTestHarness as harness } from './server-side-analytics.test-utils';

type EnvModule = typeof import('@/env');

describe('Server-Side Analytics Service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('sendServerSideAnalytics', () => {
    it('sends events to all platforms successfully', async () => {
      harness.mockSuccessfulFetch();

      const results = await sendServerSideAnalytics(
        harness.merchantId,
        'purchase',
        harness.mockUserData,
        harness.mockEventData
      );

      expect(global.fetch).toHaveBeenCalledTimes(4);

      const platforms = results.map((r) => r.platform);
      expect(platforms).toContain('GA4');
      expect(platforms).toContain('Facebook');
      expect(platforms).toContain('TikTok');
      expect(platforms).toContain('Snapchat');

      expect(results.every((r) => r.success === true)).toBe(true);
      expect(results.every((r) => r.sent === true)).toBe(true);
    });

    it('uses the configured app URL when running without window', async () => {
      vi.stubGlobal('window', undefined);
      harness.mockSuccessfulFetch();

      const results = await sendServerSideAnalytics(
        harness.merchantId,
        'purchase',
        harness.mockUserData,
        harness.mockEventData
      );

      expect(global.fetch).toHaveBeenCalledTimes(4);
      const calls = harness.getFetchCalls();
      expect(
        calls.every(([url]) =>
          url.startsWith('http://localhost:3000/api/analytics/')
        )
      ).toBe(true);
      expect(results.every((result) => result.success === true)).toBe(true);
    });

    it('handles failures from some platforms gracefully', async () => {
      harness.getFetchMock().mockImplementation((url: string) => {
        if (url.includes('facebook')) {
          return Promise.reject(new Error('Network error'));
        }
        if (url.includes('tiktok')) {
          return Promise.resolve({
            json: vi
              .fn()
              .mockResolvedValue({ success: false, error: 'API Error' }),
          });
        }
        return Promise.resolve({
          json: vi.fn().mockResolvedValue({ success: true }),
        });
      });

      const results = await sendServerSideAnalytics(
        harness.merchantId,
        'purchase',
        harness.mockUserData,
        harness.mockEventData
      );

      expect(global.fetch).toHaveBeenCalledTimes(4);

      const fbResult = results.find((r) => r.platform === 'Facebook');
      expect(fbResult?.success).toBe(false);
      expect(fbResult?.error).toBe('Network error');
      expect(fbResult?.sent).toBe(false);

      const tiktokResult = results.find((r) => r.platform === 'TikTok');
      expect(tiktokResult?.success).toBe(false);
      expect(tiktokResult?.error).toBe('API Error');
      expect(tiktokResult?.sent).toBe(true);

      const ga4Result = results.find((r) => r.platform === 'GA4');
      expect(ga4Result?.success).toBe(true);
    });
  });

  describe('trackServerSidePurchase', () => {
    it('calls sendServerSideAnalytics with purchase event mapping for platforms', async () => {
      harness.mockSuccessfulFetch();

      await trackServerSidePurchase(
        harness.merchantId,
        'order_123',
        150,
        'EUR',
        harness.mockEventData.products,
        harness.mockUserData
      );

      expect(global.fetch).toHaveBeenCalledTimes(4);

      const calls = harness.getFetchCalls();

      const fbCall = calls.find((call) => call[0].includes('facebook'));
      expect(fbCall).toBeDefined();
      if (fbCall) {
        const fbCallBody = harness.parseRequestBody(fbCall);
        harness.expectAttributionData(fbCallBody);
        expect(fbCallBody.event).toBe('Purchase');
        expect(fbCallBody.eventData).toMatchObject({
          value: 150,
          currency: 'EUR',
          transactionId: 'order_123',
          products: harness.mockEventData.products,
        });
      }

      const ga4Call = calls.find((call) => call[0].includes('ga4'));
      expect(ga4Call).toBeDefined();
      if (ga4Call) {
        const ga4CallBody = harness.parseRequestBody(ga4Call);
        harness.expectAttributionData(ga4CallBody);
        expect(ga4CallBody.event).toBe('purchase');
        expect(ga4CallBody.eventData).toMatchObject({
          value: 150,
          currency: 'EUR',
          transactionId: 'order_123',
          products: harness.mockEventData.products,
        });
      }

      const tiktokCall = calls.find((call) => call[0].includes('tiktok'));
      expect(tiktokCall).toBeDefined();
      if (tiktokCall) {
        const tiktokCallBody = harness.parseRequestBody(tiktokCall);
        harness.expectAttributionData(tiktokCallBody);
        expect(tiktokCallBody.event).toBe('purchase');
        expect(tiktokCallBody.eventData).toMatchObject({
          value: 150,
          currency: 'EUR',
          transactionId: 'order_123',
          orderId: 'order_123',
          products: harness.mockEventData.products,
        });
      }

      const snapchatCall = calls.find((call) => call[0].includes('snapchat'));
      expect(snapchatCall).toBeDefined();
      if (snapchatCall) {
        const snapchatCallBody = harness.parseRequestBody(snapchatCall);
        harness.expectAttributionData(snapchatCallBody);
        expect(snapchatCallBody.event).toBe('purchase');
        expect(snapchatCallBody.eventData).toMatchObject({
          value: 150,
          currency: 'EUR',
          transactionId: 'order_123',
          products: harness.mockEventData.products,
        });
      }
    });
  });

  describe('error handling', () => {
    it('trackServerSidePurchase handles API errors gracefully', async () => {
      harness.getFetchMock().mockResolvedValue({
        json: vi
          .fn()
          .mockResolvedValue({ success: false, error: 'Platform Error' }),
      });

      const results = await trackServerSidePurchase(
        harness.merchantId,
        'order_123',
        150,
        'EUR',
        harness.mockEventData.products,
        harness.mockUserData
      );

      expect(global.fetch).toHaveBeenCalledTimes(4);
      expect(results).toHaveLength(4);
      expect(results.every((r) => r.success === false)).toBe(true);
      expect(results.every((r) => r.error === 'Platform Error')).toBe(true);
    });

    it('trackServerSideBeginCheckout handles network rejection gracefully', async () => {
      harness.getFetchMock().mockRejectedValue(new Error('Network failure'));

      const results = await trackServerSideBeginCheckout(
        harness.merchantId,
        150,
        'EUR',
        harness.mockEventData.products,
        harness.mockUserData
      );

      expect(global.fetch).toHaveBeenCalledTimes(4);
      expect(results).toHaveLength(4);
      expect(results.every((r) => r.success === false)).toBe(true);
      expect(results.every((r) => r.error === 'Network failure')).toBe(true);
    });
  });

  describe('trackServerSideBeginCheckout', () => {
    it('calls sendServerSideAnalytics with begin_checkout event mapping for platforms', async () => {
      harness.mockSuccessfulFetch();

      await trackServerSideBeginCheckout(
        harness.merchantId,
        150,
        'EUR',
        harness.mockEventData.products,
        harness.mockUserData
      );

      expect(global.fetch).toHaveBeenCalledTimes(4);

      const calls = harness.getFetchCalls();

      const fbCall = calls.find((call) => call[0].includes('facebook'));
      expect(fbCall).toBeDefined();
      if (fbCall) {
        const fbCallBody = harness.parseRequestBody(fbCall);
        harness.expectAttributionData(fbCallBody);
        expect(fbCallBody.event).toBe('InitiateCheckout');
        expect(fbCallBody.eventData).toMatchObject({
          value: 150,
          currency: 'EUR',
          products: harness.mockEventData.products,
        });
      }

      const ga4Call = calls.find((call) => call[0].includes('ga4'));
      expect(ga4Call).toBeDefined();
      if (ga4Call) {
        const ga4CallBody = harness.parseRequestBody(ga4Call);
        harness.expectAttributionData(ga4CallBody);
        expect(ga4CallBody.event).toBe('begin_checkout');
        expect(ga4CallBody.eventData).toMatchObject({
          value: 150,
          currency: 'EUR',
          products: harness.mockEventData.products,
        });
      }

      const tiktokCall = calls.find((call) => call[0].includes('tiktok'));
      expect(tiktokCall).toBeDefined();
      if (tiktokCall) {
        const tiktokCallBody = harness.parseRequestBody(tiktokCall);
        harness.expectAttributionData(tiktokCallBody);
        expect(tiktokCallBody.event).toBe('begin_checkout');
        expect(tiktokCallBody.eventData).toMatchObject({
          value: 150,
          currency: 'EUR',
          products: harness.mockEventData.products,
        });
      }

      const snapchatCall = calls.find((call) => call[0].includes('snapchat'));
      expect(snapchatCall).toBeDefined();
      if (snapchatCall) {
        const snapchatCallBody = harness.parseRequestBody(snapchatCall);
        harness.expectAttributionData(snapchatCallBody);
        expect(snapchatCallBody.event).toBe('begin_checkout');
        expect(snapchatCallBody.eventData).toMatchObject({
          value: 150,
          currency: 'EUR',
          products: harness.mockEventData.products,
        });
      }
    });
  });
});
