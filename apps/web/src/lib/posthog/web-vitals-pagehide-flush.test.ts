// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  armWebVitalsPageHideFlush,
  flushWebVitalsBeacon,
  resetWebVitalsPageHideFlushForTesting,
} from '@/lib/posthog/web-vitals-pagehide-flush';
import {
  clearPendingPostHogWebVitals,
  drainPendingPostHogWebVitals,
  enqueuePostHogWebVital,
} from '@/lib/posthog/web-vitals-queue';

const ENV = {
  NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: 'phc_test_token',
  NEXT_PUBLIC_POSTHOG_PROXY_PATH: '/baci-relay',
  NEXT_PUBLIC_ROOT_DOMAIN: 'usebaci.com',
};

function stubBrowserGlobals({ userAgent = 'Mozilla/5.0 (real person)' } = {}) {
  const sendBeacon = vi.fn().mockReturnValue(true);
  vi.stubGlobal('navigator', { sendBeacon, userAgent });
  vi.stubGlobal('location', {
    hostname: 'ogabassey.com',
    href: 'https://ogabassey.com/?gclid=abc',
    pathname: '/',
  });
  return { sendBeacon };
}

function vital(
  overrides: Partial<
    import('@/lib/posthog/web-vitals-queue').PostHogWebVitalsPayload
  > &
    Pick<
      import('@/lib/posthog/web-vitals-queue').PostHogWebVitalsPayload,
      'metric' | 'value'
    >
) {
  return {
    rating: 'good',
    navigationType: 'navigate',
    pathname: '/',
    ...overrides,
  };
}

async function decodeBeaconBodyAsync(call: unknown[]): Promise<{
  api_key: string;
  distinct_id: string;
  event: string;
  properties: Record<string, unknown>;
}> {
  const blob = call[1] as Blob;
  return JSON.parse(await blob.text());
}

describe('flushWebVitalsBeacon', () => {
  beforeEach(() => {
    clearPendingPostHogWebVitals();
    resetWebVitalsPageHideFlushForTesting();
    globalThis.localStorage?.clear?.();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearPendingPostHogWebVitals();
  });

  it('drains the queue and beacons one web_vitals event per queued metric', async () => {
    const { sendBeacon } = stubBrowserGlobals();
    enqueuePostHogWebVital(vital({ metric: 'LCP', value: 1234, id: 'v5-1' }));
    enqueuePostHogWebVital(vital({ metric: 'CLS', value: 0.01, id: 'v5-2' }));

    const sent = flushWebVitalsBeacon(ENV);

    expect(sent).toBe(2);
    expect(sendBeacon).toHaveBeenCalledTimes(2);
    expect(sendBeacon.mock.calls[0][0]).toBe('/baci-relay/i/v0/e/');
    const body = await decodeBeaconBodyAsync(sendBeacon.mock.calls[0]);
    expect(body.event).toBe('web_vitals');
    expect(body.api_key).toBe('phc_test_token');
    expect(body.properties.metric).toBe('LCP');
    expect(body.properties.capture_mode).toBe('pagehide_beacon');
    expect(body.properties.$process_person_profile).toBe(false);
    // Drained: a later PostHog boot flushes an empty queue (no double-report).
    expect(drainPendingPostHogWebVitals()).toHaveLength(0);
  });

  it('redacts query strings from $current_url, $pathname and lcpUrl', async () => {
    const { sendBeacon } = stubBrowserGlobals();
    enqueuePostHogWebVital(
      vital({
        metric: 'LCP',
        value: 900,
        id: 'v5-3',
        lcpUrl: 'https://cdn.ogabassey.com/img.avif?width=750&sig=secret',
      })
    );

    flushWebVitalsBeacon(ENV);

    const body = await decodeBeaconBodyAsync(sendBeacon.mock.calls[0]);
    // enqueue pinned $current_url from location.href (includes ?gclid=abc)
    expect(String(body.properties.$current_url)).not.toContain('gclid');
    expect(String(body.properties.lcpUrl)).not.toContain('sig=');
    expect(String(body.properties.$pathname)).not.toMatch(/[?#]/);
  });

  // Identity/persistence behaviors (token trim, persisted distinct_id and
  // deviceId reuse, generate+seed, storage-blocked in-memory fallback) are
  // covered in web-vitals-pagehide-flush.identity.test.ts.

  it('resolves $host and tenant context from the metric URL, not the post-navigation location', async () => {
    const { sendBeacon } = stubBrowserGlobals();
    // LCP pinned on merchant A; user then navigates to merchant B before hide.
    enqueuePostHogWebVital(
      vital({
        metric: 'LCP',
        value: 1200,
        $current_url: 'https://merchant-a.example/product/x?utm=1',
      })
    );
    vi.stubGlobal('location', {
      hostname: 'merchant-b.example',
      href: 'https://merchant-b.example/',
      pathname: '/',
    });
    flushWebVitalsBeacon(ENV);
    const body = await decodeBeaconBodyAsync(sendBeacon.mock.calls[0]);
    expect(body.properties.$host).toBe('merchant-a.example');
    expect(body.properties.merchant_domain).toBe('merchant-a.example');
  });

  it('email-scrubs free-form attribution fields to match before_send parity', async () => {
    const { sendBeacon } = stubBrowserGlobals();
    enqueuePostHogWebVital(
      vital({
        metric: 'INP',
        value: 300,
        id: 'v5-pii',
        debugTarget: 'a[href="mailto:shopper@example.com"]',
      })
    );
    flushWebVitalsBeacon(ENV);
    const body = await decodeBeaconBodyAsync(sendBeacon.mock.calls[0]);
    const debugTarget = String(body.properties.debugTarget);
    expect(debugTarget).not.toContain('shopper@example.com');
    expect(debugTarget).toContain('[Filtered]');
  });

  it('drops queued vitals without beaconing for bot user agents', () => {
    const { sendBeacon } = stubBrowserGlobals({
      userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1)',
    });
    enqueuePostHogWebVital(vital({ metric: 'LCP', value: 1000, id: 'v5-6' }));

    const sent = flushWebVitalsBeacon(ENV);

    expect(sent).toBe(0);
    expect(sendBeacon).not.toHaveBeenCalled();
    expect(drainPendingPostHogWebVitals()).toHaveLength(0);
  });

  it('does nothing without a project token', () => {
    const { sendBeacon } = stubBrowserGlobals();
    enqueuePostHogWebVital(vital({ metric: 'LCP', value: 1000, id: 'v5-7' }));

    const sent = flushWebVitalsBeacon({
      ...ENV,
      NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: undefined,
    });

    expect(sent).toBe(0);
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it('bails from an unactivated prerender without draining', () => {
    const { sendBeacon } = stubBrowserGlobals();
    enqueuePostHogWebVital(vital({ metric: 'LCP', value: 1000, id: 'v5-8' }));
    Object.defineProperty(document, 'prerendering', {
      configurable: true,
      value: true,
    });

    try {
      const sent = flushWebVitalsBeacon(ENV);
      expect(sent).toBe(0);
      expect(sendBeacon).not.toHaveBeenCalled();
      // Not drained: metrics survive for the activated page's flush.
      expect(drainPendingPostHogWebVitals()).toHaveLength(1);
    } finally {
      Object.defineProperty(document, 'prerendering', {
        configurable: true,
        value: undefined,
      });
    }
  });
});

describe('armWebVitalsPageHideFlush', () => {
  beforeEach(() => {
    clearPendingPostHogWebVitals();
    resetWebVitalsPageHideFlushForTesting();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearPendingPostHogWebVitals();
  });

  it('flushes when the document becomes hidden and is idempotent to re-arming', () => {
    const { sendBeacon } = stubBrowserGlobals();
    armWebVitalsPageHideFlush(ENV);
    armWebVitalsPageHideFlush(ENV);
    enqueuePostHogWebVital(vital({ metric: 'INP', value: 250, id: 'v5-9' }));

    try {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: 'hidden',
      });
      document.dispatchEvent(new Event('visibilitychange'));

      // One listener despite double-arm; drain-based so exactly one beacon.
      expect(sendBeacon).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: 'visible',
      });
    }
  });

  it('flushes on pagehide (Safari fallback) with nothing left for a second flush', () => {
    const { sendBeacon } = stubBrowserGlobals();
    armWebVitalsPageHideFlush(ENV);
    enqueuePostHogWebVital(vital({ metric: 'LCP', value: 1500, id: 'v5-10' }));

    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('pagehide'));

    expect(sendBeacon).toHaveBeenCalledTimes(1);
  });
});
