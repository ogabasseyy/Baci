import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * R5 paging: every receiver alert is also sent as a server-side PostHog
 * `piggyvest_money_alert`. The send is fire-and-forget, so a PostHog
 * failure, a hang or a synchronous throw must leave each reply exactly as
 * it is when PostHog is healthy. Real HMAC and the in-memory capture store;
 * processing collaborators and PostHog are mocked.
 */

type CaptureServerEvent = (
  event: string,
  properties: { code: string }
) => unknown;

const mocks = vi.hoisted(() => ({
  captureServerEvent: vi.fn<CaptureServerEvent>(),
  createServiceClient: vi.fn(),
  processPiggyvestEvent: vi.fn(),
  recordPiggyvestEvent: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/env', () => ({ getPiggyvestApiConfig: () => null }));
vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: (event: string, properties: { code: string }) =>
    mocks.captureServerEvent(event, properties),
}));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => mocks.createServiceClient(),
}));
vi.mock('@/lib/piggyvest/webhook-processor', () => ({
  processPiggyvestEvent: (...args: unknown[]) =>
    mocks.processPiggyvestEvent(...args),
}));
vi.mock('@/lib/piggyvest/webhook-inbox', () => ({
  recordPiggyvestEvent: (...args: unknown[]) =>
    mocks.recordPiggyvestEvent(...args),
}));

import { deterministicKeySource } from '@/lib/piggyvest/deterministic-test-data.test-support';
import { createFakeCaptureStore } from './route.capture-test-support';

const freshKey = deterministicKeySource('route.money-alert');

const accrued = JSON.stringify({
  eventId: 'evt-money-alert-1',
  eventType: 'interest-accrued.success',
  eventCategory: 'interest_accrued',
  customer_id: 'customer-1',
  eventData: { id: 'accrual-1', amount: 12.5 },
});

type Failure = () => unknown;

const HEALTHY: Failure = () => Promise.resolve(true);
const FAILURES: [string, Failure][] = [
  ['rejects', () => Promise.reject(new Error('posthog down'))],
  ['never answers', () => new Promise<boolean>(() => {})],
  [
    'throws synchronously',
    () => {
      throw new Error('posthog misconfigured');
    },
  ],
];

let current: string;
let store: ReturnType<typeof createFakeCaptureStore>;

beforeEach(() => {
  vi.clearAllMocks();
  current = freshKey();
  vi.stubEnv('PIGGYVEST_SECRET_KEY', current);
  vi.stubEnv('PVB_SECRET_KEY', '');
  vi.stubEnv('PIGGYVEST_WEBHOOK_KEY_ARCHIVE', '');
  vi.stubEnv('PIGGYVEST_WEBHOOK_KEY_OVERLAP_HOURS', '');
  vi.stubEnv('VERCEL_ENV', 'preview');
  mocks.createServiceClient.mockImplementation(() => store.client());
  mocks.recordPiggyvestEvent.mockResolvedValue('new');
  mocks.processPiggyvestEvent.mockResolvedValue('processed');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/**
 * One delivery against a freshly loaded route and an empty capture store, so
 * the PostHog dedupe memory and the stored rows start empty on every run.
 */
async function reply(posthog: Failure, { failCapture = false } = {}) {
  vi.resetModules();
  store = createFakeCaptureStore();
  store.failCapture = failCapture;
  mocks.captureServerEvent.mockReset();
  mocks.captureServerEvent.mockImplementation(posthog);
  const { POST } = await import('./route');
  const signature = createHmac('sha512', current).update(accrued).digest('hex');
  const response = await POST(
    new NextRequest('https://usebaci.com/api/webhooks/piggyvest', {
      method: 'POST',
      body: accrued,
      headers: {
        'content-type': 'application/json',
        'x-pvb-signature': signature,
      },
    })
  );
  return {
    status: response.status,
    body: await response.json(),
    cacheControl: response.headers.get('cache-control'),
    paged: mocks.captureServerEvent.mock.calls.map(([event, properties]) => [
      event,
      properties.code,
    ]),
  };
}

describe.each(FAILURES)('when PostHog %s', (_label, failure) => {
  it('answers a missing key configuration with the same 503', async () => {
    vi.stubEnv('PIGGYVEST_SECRET_KEY', '');

    const healthy = await reply(HEALTHY);
    const failing = await reply(failure);

    expect(healthy).toMatchObject({
      status: 503,
      body: { error: 'Integration unavailable', code: 'PIGGYVEST_NOT_READY' },
      paged: [['piggyvest_money_alert', 'PIGGYVEST_WEBHOOK_KEYS_UNCONFIGURED']],
    });
    expect(failing).toEqual(healthy);
  });

  it('answers a failed capture write with the same 503 and stores nothing', async () => {
    const healthy = await reply(HEALTHY, { failCapture: true });
    const failing = await reply(failure, { failCapture: true });

    expect(healthy).toMatchObject({
      status: 503,
      body: {
        error: 'Event intake unavailable',
        code: 'PIGGYVEST_CAPTURE_UNAVAILABLE',
      },
      paged: [['piggyvest_money_alert', 'PIGGYVEST_WEBHOOK_CAPTURE_FAILED']],
    });
    expect(failing).toEqual(healthy);
    expect(store.rows).toEqual([]);
  });

  it('answers a captured delivery whose processing threw with the same reply', async () => {
    mocks.processPiggyvestEvent.mockRejectedValue(new Error('synthetic'));

    const healthy = await reply(HEALTHY);
    const failing = await reply(failure);

    expect(healthy).toMatchObject({
      status: 503,
      body: {
        received: true,
        captured: true,
        processing: 'retry',
        code: 'PIGGYVEST_PROCESSING_RETRY',
      },
      paged: [
        ['piggyvest_money_alert', 'PIGGYVEST_WEBHOOK_PROCESSING_DEFERRED'],
      ],
    });
    expect(failing).toEqual(healthy);
    expect(store.rows).toHaveLength(1);
  });
});
