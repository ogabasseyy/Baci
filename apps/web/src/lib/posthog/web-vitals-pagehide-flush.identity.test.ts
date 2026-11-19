// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  flushWebVitalsBeacon,
  resetWebVitalsPageHideFlushForTesting,
} from '@/lib/posthog/web-vitals-pagehide-flush';
import {
  clearPendingPostHogWebVitals,
  enqueuePostHogWebVital,
  type PostHogWebVitalsPayload,
} from '@/lib/posthog/web-vitals-queue';

const ENV = {
  NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: 'phc_test_token',
  NEXT_PUBLIC_POSTHOG_PROXY_PATH: '/baci-relay',
  NEXT_PUBLIC_ROOT_DOMAIN: 'usebaci.com',
};

function stubBrowserGlobals() {
  const sendBeacon = vi.fn().mockReturnValue(true);
  vi.stubGlobal('navigator', {
    sendBeacon,
    userAgent: 'Mozilla/5.0 (real person)',
  });
  vi.stubGlobal('location', {
    hostname: 'ogabassey.com',
    href: 'https://ogabassey.com/',
    pathname: '/',
  });
  return { sendBeacon };
}

function vital(
  overrides: Partial<PostHogWebVitalsPayload> &
    Pick<PostHogWebVitalsPayload, 'metric' | 'value'>
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
  properties: Record<string, unknown>;
}> {
  const blob = call[1] as Blob;
  return JSON.parse(await blob.text());
}

describe('flushWebVitalsBeacon identity persistence', () => {
  beforeEach(() => {
    clearPendingPostHogWebVitals();
    resetWebVitalsPageHideFlushForTesting();
    globalThis.localStorage?.clear?.();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearPendingPostHogWebVitals();
  });

  it('trims surrounding whitespace from the project token before beaconing', async () => {
    const { sendBeacon } = stubBrowserGlobals();
    enqueuePostHogWebVital(
      vital({ metric: 'TTFB', value: 250, id: 'v5-trim' })
    );

    flushWebVitalsBeacon({
      ...ENV,
      NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: '  phc_test_token  ',
    });

    const body = await decodeBeaconBodyAsync(sendBeacon.mock.calls[0]);
    expect(body.api_key).toBe('phc_test_token');
    expect(body.properties.token).toBe('phc_test_token');
    // Persistence key derives from the TRIMMED token (same key a later boot uses).
    const persisted = JSON.parse(
      globalThis.localStorage.getItem('ph_phc_test_token_posthog') ?? '{}'
    );
    expect(persisted.distinct_id).toBe(body.distinct_id);
  });

  it('reuses the persisted SDK distinct_id when present', async () => {
    const { sendBeacon } = stubBrowserGlobals();
    globalThis.localStorage.setItem(
      'ph_phc_test_token_posthog',
      JSON.stringify({ distinct_id: 'persisted-user-1' })
    );
    enqueuePostHogWebVital(vital({ metric: 'TTFB', value: 300, id: 'v5-4' }));

    flushWebVitalsBeacon(ENV);

    const body = await decodeBeaconBodyAsync(sendBeacon.mock.calls[0]);
    expect(body.distinct_id).toBe('persisted-user-1');
  });

  it('falls back to the persisted deviceId when no distinct_id exists', async () => {
    const { sendBeacon } = stubBrowserGlobals();
    globalThis.localStorage.setItem(
      'ph_phc_test_token_posthog',
      JSON.stringify({ $device_id: 'device-only-7' })
    );
    enqueuePostHogWebVital(vital({ metric: 'CLS', value: 0.02, id: 'v5-4b' }));

    flushWebVitalsBeacon(ENV);

    const body = await decodeBeaconBodyAsync(sendBeacon.mock.calls[0]);
    expect(body.distinct_id).toBe('device-only-7');
  });

  it('backfills a deviceId-only persistence record with distinct_id (later boot adopts the same identity)', async () => {
    const { sendBeacon } = stubBrowserGlobals();
    globalThis.localStorage.setItem(
      'ph_phc_test_token_posthog',
      JSON.stringify({ $device_id: 'device-only-backfill' })
    );
    enqueuePostHogWebVital(
      vital({ metric: 'LCP', value: 1200, id: 'v5-backfill' })
    );

    flushWebVitalsBeacon(ENV);

    const body = await decodeBeaconBodyAsync(sendBeacon.mock.calls[0]);
    expect(body.distinct_id).toBe('device-only-backfill');

    const persisted = JSON.parse(
      globalThis.localStorage.getItem('ph_phc_test_token_posthog') ?? '{}'
    );
    expect(persisted.distinct_id).toBe('device-only-backfill');
    expect(persisted.$device_id).toBe('device-only-backfill');
  });

  it('does not throw when backfilling the deviceId fails because storage writes are blocked', async () => {
    const { sendBeacon } = stubBrowserGlobals();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) =>
        key === 'ph_phc_test_token_posthog'
          ? JSON.stringify({ $device_id: 'device-only-blocked-write' })
          : null,
      setItem: () => {
        throw new Error('storage write blocked');
      },
    });
    enqueuePostHogWebVital(
      vital({ metric: 'INP', value: 150, id: 'v5-blocked-write' })
    );

    expect(() => flushWebVitalsBeacon(ENV)).not.toThrow();

    const body = await decodeBeaconBodyAsync(sendBeacon.mock.calls[0]);
    expect(body.distinct_id).toBe('device-only-blocked-write');
  });

  it('generates and seeds a distinct_id when none is persisted (later boot adopts it)', async () => {
    const { sendBeacon } = stubBrowserGlobals();
    enqueuePostHogWebVital(vital({ metric: 'FCP', value: 800, id: 'v5-5' }));

    flushWebVitalsBeacon(ENV);

    const body = await decodeBeaconBodyAsync(sendBeacon.mock.calls[0]);
    const persisted = JSON.parse(
      globalThis.localStorage.getItem('ph_phc_test_token_posthog') ?? '{}'
    );
    expect(persisted.distinct_id).toBe(body.distinct_id);
  });

  it('keeps one generated distinct_id across consecutive flushes when storage is blocked', async () => {
    const { sendBeacon } = stubBrowserGlobals();
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('storage blocked');
      },
    });
    // hidden → restored → hidden again before PostHog boots: two flushes of
    // the SAME pre-boot session must not mint two different visitors.
    enqueuePostHogWebVital(vital({ metric: 'LCP', value: 1000, id: 'v5-b1' }));
    flushWebVitalsBeacon(ENV);
    enqueuePostHogWebVital(vital({ metric: 'INP', value: 200, id: 'v5-b2' }));
    flushWebVitalsBeacon(ENV);

    expect(sendBeacon).toHaveBeenCalledTimes(2);
    const first = await decodeBeaconBodyAsync(sendBeacon.mock.calls[0]);
    const second = await decodeBeaconBodyAsync(sendBeacon.mock.calls[1]);
    expect(first.distinct_id).toBe(second.distinct_id);
  });

  it('keeps one generated distinct_id across flushes when localStorage is absent', async () => {
    const { sendBeacon } = stubBrowserGlobals();
    vi.stubGlobal('localStorage', undefined);
    enqueuePostHogWebVital(vital({ metric: 'LCP', value: 900, id: 'v5-n1' }));
    flushWebVitalsBeacon(ENV);
    enqueuePostHogWebVital(vital({ metric: 'CLS', value: 0.1, id: 'v5-n2' }));
    flushWebVitalsBeacon(ENV);

    const first = await decodeBeaconBodyAsync(sendBeacon.mock.calls[0]);
    const second = await decodeBeaconBodyAsync(sendBeacon.mock.calls[1]);
    expect(first.distinct_id).toBe(second.distinct_id);
  });
});
