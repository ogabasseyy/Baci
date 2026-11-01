import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildPiggyvestMoneyAlertProperties,
  createPiggyvestMoneyAlertSender,
  PIGGYVEST_MONEY_ALERT_EVENT,
  PIGGYVEST_MONEY_ALERT_TIMEOUT_MS,
  type PiggyvestMoneyAlertDeps,
} from './piggyvest-money-alert-events';

vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: vi.fn(() => Promise.resolve(true)),
}));

const CAPTURE_A = '4204dc18-efb3-44d0-b9a2-1362448d4f21';
const CAPTURE_B = '9b1c6f0e-2d7a-4c3e-8f51-0a6e2b9d7c14';
const OPERATION = '00000000-0000-4000-8000-000000000002';
const ENV = { VERCEL_ENV: 'production' };

function sender(overrides: Partial<PiggyvestMoneyAlertDeps> = {}) {
  const capture = vi.fn<PiggyvestMoneyAlertDeps['capture']>(() =>
    Promise.resolve(true)
  );
  const keepAlive = vi.fn<PiggyvestMoneyAlertDeps['keepAlive']>();
  const send = createPiggyvestMoneyAlertSender({
    capture,
    keepAlive,
    now: () => 0,
    env: ENV,
    ...overrides,
  });
  return { send, capture, keepAlive };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('buildPiggyvestMoneyAlertProperties', () => {
  it('maps the allowlisted detail to snake_case properties', () => {
    expect(
      buildPiggyvestMoneyAlertProperties(
        'PIGGYVEST_WEBHOOK_NEEDS_REVIEW',
        {
          keyVersion: 'pv-2026-09',
          reason: 'handler rejected the event',
          captureId: CAPTURE_A,
          eventType: 'interest-accrued.success',
          attempts: 3,
          operationId: OPERATION,
        },
        ENV
      )
    ).toEqual({
      code: 'PIGGYVEST_WEBHOOK_NEEDS_REVIEW',
      deployment_environment: 'production',
      key_version: 'pv-2026-09',
      reason: 'handler rejected the event',
      capture_id: CAPTURE_A,
      event_type: 'interest-accrued.success',
      attempts: 3,
      operation_id: OPERATION,
    });
  });

  it('never carries a field outside the allowlist', () => {
    const properties = buildPiggyvestMoneyAlertProperties(
      'PIGGYVEST_WEBHOOK_CAPTURE_FAILED',
      {
        reason: 'durable capture write failed',
        // @ts-expect-error unknown fields must never reach PostHog
        body: '{"account_number":"0123456789"}',
        signature: 'a'.repeat(128),
        secret: 'sk_live_value',
        email: 'customer@example.com',
        phone: '+2348012345678',
      },
      ENV
    );

    expect(Object.keys(properties).sort()).toEqual([
      'code',
      'deployment_environment',
      'reason',
    ]);
    expect(JSON.stringify(properties)).not.toMatch(
      /0123456789|sk_live|example\.com|2348012345678|aaaa/
    );
  });

  it('filters emails and long digit runs out of the free-text reason', () => {
    const { reason } = buildPiggyvestMoneyAlertProperties(
      'PIGGYVEST_RESTRICTION_BLOCKED',
      {
        reason:
          'lien on 0123456789 for customer@example.com, phone +2348012345678',
      },
      ENV
    );

    expect(reason).toBe('lien on [Filtered] for [Filtered], phone +[Filtered]');
  });

  it('filters numbers written with spaces or dashes between digit groups', () => {
    const { reason } = buildPiggyvestMoneyAlertProperties(
      'PIGGYVEST_RESTRICTION_BLOCKED',
      {
        reason:
          'lien on 0123-456-789, phone +234 801 234 5678 or 0801 234 5678, try 3 of 5',
      },
      ENV
    );

    expect(reason).toBe(
      'lien on [Filtered], phone +[Filtered] or [Filtered], try 3 of 5'
    );
  });

  it('drops identifiers that are not plain identifiers, and bad attempt counts', () => {
    const properties = buildPiggyvestMoneyAlertProperties(
      'PIGGYVEST_WEBHOOK_REPLAY_UNVERIFIABLE',
      {
        captureId: 'not an id; customer@example.com',
        eventType: `${'x'.repeat(120)}…`,
        keyVersion: '',
        operationId: 'op id with spaces',
        attempts: -1,
      },
      ENV
    );

    expect(properties).toEqual({
      code: 'PIGGYVEST_WEBHOOK_REPLAY_UNVERIFIABLE',
      deployment_environment: 'production',
    });
    expect(
      buildPiggyvestMoneyAlertProperties(
        'PIGGYVEST_WEBHOOK_NEEDS_REVIEW',
        { attempts: 1.5 },
        ENV
      )
    ).not.toHaveProperty('attempts');
  });

  it('labels the deployment so preview traffic can be filtered out of paging', () => {
    expect(
      buildPiggyvestMoneyAlertProperties('PIGGYVEST_NEGATIVE_DRIFT', {}, {})
        .deployment_environment
    ).toBe('development');
    expect(
      buildPiggyvestMoneyAlertProperties(
        'PIGGYVEST_NEGATIVE_DRIFT',
        {},
        { NODE_ENV: 'production' }
      ).deployment_environment
    ).toBe('production');
  });
});

describe('createPiggyvestMoneyAlertSender', () => {
  it('sends one piggyvest_money_alert with a deterministic event id', async () => {
    const { send, capture } = sender();

    await expect(
      send('PIGGYVEST_INTEREST_BACKFILLED', { captureId: CAPTURE_A })
    ).resolves.toBe('sent');

    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith(
      PIGGYVEST_MONEY_ALERT_EVENT,
      {
        code: 'PIGGYVEST_INTEREST_BACKFILLED',
        deployment_environment: 'production',
        capture_id: CAPTURE_A,
      },
      undefined,
      expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-/)
    );
    const again = sender();
    await again.send('PIGGYVEST_INTEREST_BACKFILLED', { captureId: CAPTURE_A });
    expect(again.capture.mock.calls[0]?.[3]).toBe(capture.mock.calls[0]?.[3]);
  });

  it('dedupes per capture id and code', async () => {
    const { send, capture } = sender();

    await send('PIGGYVEST_FEE_UNATTRIBUTED', { captureId: CAPTURE_A });
    await expect(
      send('PIGGYVEST_FEE_UNATTRIBUTED', { captureId: CAPTURE_A, attempts: 2 })
    ).resolves.toBe('duplicate');
    await send('PIGGYVEST_FEE_UNATTRIBUTED', { captureId: CAPTURE_B });
    await send('PIGGYVEST_INFLOW_REVIEW_OPEN', { captureId: CAPTURE_A });

    const sent = capture.mock.calls.map(([, properties]) => [
      properties.code,
      properties.capture_id,
    ]);
    expect(sent).toEqual([
      ['PIGGYVEST_FEE_UNATTRIBUTED', CAPTURE_A],
      ['PIGGYVEST_FEE_UNATTRIBUTED', CAPTURE_B],
      ['PIGGYVEST_INFLOW_REVIEW_OPEN', CAPTURE_A],
    ]);
    const ids = new Set(capture.mock.calls.map((call) => call[3]));
    expect(ids.size).toBe(3);
  });

  it('dedupes an alert without a capture by its operation id', async () => {
    const { send, capture } = sender();

    await send('PIGGYVEST_TRANSFER_NEEDS_REVIEW', { operationId: OPERATION });
    await send('PIGGYVEST_TRANSFER_NEEDS_REVIEW', {
      operationId: OPERATION,
      reason: 'card_reference_failed',
    });

    expect(capture).toHaveBeenCalledTimes(1);
  });

  it('repeats an alert with no identity at most once per ten-minute window', async () => {
    let now = 0;
    const { send, capture } = sender({ now: () => now });

    await send('PIGGYVEST_WEBHOOK_KEYS_UNCONFIGURED', { reason: 'no key' });
    now = 9 * 60_000;
    await send('PIGGYVEST_WEBHOOK_KEYS_UNCONFIGURED', { reason: 'no key' });
    await send('PIGGYVEST_WEBHOOK_KEY_REVOKED', { keyVersion: 'pv-2026-09' });
    await send('PIGGYVEST_WEBHOOK_KEY_REVOKED', { keyVersion: 'pv-2026-10' });
    now = 10 * 60_000;
    await send('PIGGYVEST_WEBHOOK_KEYS_UNCONFIGURED', { reason: 'no key' });

    expect(capture.mock.calls.map(([, properties]) => properties.code)).toEqual(
      [
        'PIGGYVEST_WEBHOOK_KEYS_UNCONFIGURED',
        'PIGGYVEST_WEBHOOK_KEY_REVOKED',
        'PIGGYVEST_WEBHOOK_KEY_REVOKED',
        'PIGGYVEST_WEBHOOK_KEYS_UNCONFIGURED',
      ]
    );
  });

  it.each([
    ['answers false', () => Promise.resolve(false)],
    ['rejects', () => Promise.reject(new Error('posthog down'))],
    [
      'throws synchronously',
      () => {
        throw new Error('posthog misconfigured');
      },
    ],
  ])('resolves failed and lets a later alert retry when PostHog %s', async (_label, failure) => {
    const capture = vi
      .fn<PiggyvestMoneyAlertDeps['capture']>()
      .mockImplementationOnce(failure)
      .mockResolvedValue(true);
    const { send } = sender({ capture });

    await expect(
      send('PIGGYVEST_ENGINE_CREDIT_NOT_BACKED', { captureId: CAPTURE_A })
    ).resolves.toBe('failed');
    await expect(
      send('PIGGYVEST_ENGINE_CREDIT_NOT_BACKED', { captureId: CAPTURE_A })
    ).resolves.toBe('sent');
    expect(capture).toHaveBeenCalledTimes(2);
  });

  it('gives up after the timeout when PostHog never answers', async () => {
    vi.useFakeTimers();
    const capture = vi
      .fn<PiggyvestMoneyAlertDeps['capture']>()
      .mockImplementationOnce(() => new Promise<boolean>(() => {}))
      .mockResolvedValue(true);
    const { send, keepAlive } = sender({ capture });

    const pending = send('PIGGYVEST_MAIN_WALLET_INTEREST_MISROUTED', {
      captureId: CAPTURE_A,
    });
    await vi.advanceTimersByTimeAsync(PIGGYVEST_MONEY_ALERT_TIMEOUT_MS);

    await expect(pending).resolves.toBe('failed');
    expect(keepAlive).toHaveBeenCalledWith(pending);
    await expect(
      send('PIGGYVEST_MAIN_WALLET_INTEREST_MISROUTED', { captureId: CAPTURE_A })
    ).resolves.toBe('sent');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the send alive past the reply, and survives a failing keep-alive', async () => {
    const keepAlive = vi.fn<PiggyvestMoneyAlertDeps['keepAlive']>(() => {
      throw new TypeError('no request context');
    });
    const { send } = sender({ keepAlive });

    await expect(
      send('PIGGYVEST_GOAL_INTEREST_MISROUTED', { captureId: CAPTURE_A })
    ).resolves.toBe('sent');
    expect(keepAlive).toHaveBeenCalledTimes(1);
  });
});
