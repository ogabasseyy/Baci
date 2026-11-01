import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as WebhookAlerts from './webhook-alerts';

type CaptureServerEvent = (
  event: string,
  properties: Record<string, unknown>,
  distinctId?: string,
  uuid?: string
) => Promise<boolean>;

const posthog = vi.hoisted(() => ({
  captureServerEvent: vi.fn<CaptureServerEvent>(),
}));

vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: (...args: Parameters<CaptureServerEvent>) =>
    posthog.captureServerEvent(...args),
}));

const CAPTURE_ID = '4204dc18-efb3-44d0-b9a2-1362448d4f21';

const EXPECTED_CODES = [
  'PIGGYVEST_WEBHOOK_KEYS_UNCONFIGURED',
  'PIGGYVEST_WEBHOOK_KEY_REVOKED',
  'PIGGYVEST_WEBHOOK_CAPTURE_FAILED',
  'PIGGYVEST_WEBHOOK_PROCESSING_DEFERRED',
  'PIGGYVEST_WEBHOOK_REPLAY_UNVERIFIABLE',
  'PIGGYVEST_WEBHOOK_NEEDS_REVIEW',
  'PIGGYVEST_TRANSFER_NEEDS_REVIEW',
  'PIGGYVEST_PRIMARY_ROUTING_NEEDS_REVIEW',
  'PIGGYVEST_PRIMARY_OWNERSHIP_NEEDS_REVIEW',
  'PIGGYVEST_RESTRICTION_BLOCKED',
  'PIGGYVEST_INTEREST_BACKFILLED',
  'PIGGYVEST_FEE_UNATTRIBUTED',
  'PIGGYVEST_MAIN_WALLET_INTEREST_MISROUTED',
  'PIGGYVEST_GOAL_INTEREST_MISROUTED',
  'PIGGYVEST_ENGINE_CREDIT_NOT_BACKED',
  'PIGGYVEST_INFLOW_REVIEW_OPEN',
  'PIGGYVEST_NEGATIVE_DRIFT',
] as const;

let alerts: typeof WebhookAlerts;
let error: ReturnType<typeof vi.spyOn>;

const settle = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(async () => {
  // A fresh module per test: the PostHog dedupe memory starts empty.
  vi.resetModules();
  posthog.captureServerEvent.mockReset();
  posthog.captureServerEvent.mockResolvedValue(true);
  vi.stubEnv('VERCEL_ENV', 'production');
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
  alerts = await import('./webhook-alerts');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('emitPiggyvestWebhookAlert console line', () => {
  it('writes one structured, greppable line with allowlisted detail only', () => {
    alerts.emitPiggyvestWebhookAlert('PIGGYVEST_WEBHOOK_KEY_REVOKED', {
      keyVersion: 'pv-2026-09',
      attempts: 3,
      // @ts-expect-error unknown fields must never be logged
      body: '{"secret":"leak"}',
    });
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      '[PiggyVest Webhook][ALERT] PIGGYVEST_WEBHOOK_KEY_REVOKED {"keyVersion":"pv-2026-09","attempts":3}'
    );
  });

  it('names the operation of a transfer held for review', () => {
    alerts.emitPiggyvestWebhookAlert('PIGGYVEST_TRANSFER_NEEDS_REVIEW', {
      reason: 'savings_reference_not_found',
      operationId: '00000000-0000-4000-8000-000000000002',
    });
    expect(error).toHaveBeenCalledWith(
      '[PiggyVest Webhook][ALERT] PIGGYVEST_TRANSFER_NEEDS_REVIEW {"reason":"savings_reference_not_found","operationId":"00000000-0000-4000-8000-000000000002"}'
    );
  });

  it('bounds free-text detail', () => {
    alerts.emitPiggyvestWebhookAlert('PIGGYVEST_WEBHOOK_CAPTURE_FAILED', {
      reason: 'x'.repeat(500),
    });
    expect(String(error.mock.calls[0]?.[0]).length).toBeLessThan(260);
  });
});

describe('PiggyVest alert codes', () => {
  it('declares the money codes, reserves negative drift, and reuses transfer review for stale transfers', () => {
    expect([...alerts.PIGGYVEST_WEBHOOK_ALERT_CODES]).toEqual(EXPECTED_CODES);
    expect(alerts.PIGGYVEST_WEBHOOK_ALERT_CODES).not.toContain(
      'PIGGYVEST_TRANSFER_UNCERTAIN_STALE'
    );
  });

  it.each(
    EXPECTED_CODES
  )('%s writes one console line and one PostHog capture', async (code) => {
    alerts.emitPiggyvestWebhookAlert(code, {
      captureId: CAPTURE_ID,
      reason: 'synthetic reason',
    });
    await settle();

    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      `[PiggyVest Webhook][ALERT] ${code} {"reason":"synthetic reason","captureId":"${CAPTURE_ID}"}`
    );
    expect(posthog.captureServerEvent).toHaveBeenCalledTimes(1);
    expect(posthog.captureServerEvent).toHaveBeenCalledWith(
      'piggyvest_money_alert',
      {
        code,
        deployment_environment: 'production',
        reason: 'synthetic reason',
        capture_id: CAPTURE_ID,
      },
      undefined,
      expect.any(String)
    );
  });
});

describe('emitPiggyvestWebhookAlert PostHog page', () => {
  it('sends allowlisted properties only, never body, signature, key or PII', async () => {
    alerts.emitPiggyvestWebhookAlert('PIGGYVEST_WEBHOOK_NEEDS_REVIEW', {
      captureId: CAPTURE_ID,
      eventType: 'wallet.transfer.success',
      keyVersion: 'pv-2026-09',
      attempts: 5,
      reason: 'handler refused for customer@example.com 08012345678',
      // @ts-expect-error unknown fields must never reach PostHog
      body: '{"account_number":"0123456789"}',
      signature: 'f'.repeat(128),
      secretKey: 'synthetic-key-material',
      customerName: 'Ada Lovelace',
    });
    await settle();

    const properties = posthog.captureServerEvent.mock.calls[0]?.[1] ?? {};
    expect(Object.keys(properties).sort()).toEqual([
      'attempts',
      'capture_id',
      'code',
      'deployment_environment',
      'event_type',
      'key_version',
      'reason',
    ]);
    expect(JSON.stringify(properties)).not.toMatch(
      /0123456789|08012345678|example\.com|ffff|synthetic-key|Ada/
    );
  });

  it('dedupes the page per capture id and code but always writes the console line', async () => {
    const detail = { captureId: CAPTURE_ID, reason: 'retry' };
    alerts.emitPiggyvestWebhookAlert(
      'PIGGYVEST_WEBHOOK_PROCESSING_DEFERRED',
      detail
    );
    await settle();
    alerts.emitPiggyvestWebhookAlert(
      'PIGGYVEST_WEBHOOK_PROCESSING_DEFERRED',
      detail
    );
    alerts.emitPiggyvestWebhookAlert('PIGGYVEST_WEBHOOK_NEEDS_REVIEW', detail);
    await settle();

    expect(error).toHaveBeenCalledTimes(3);
    expect(
      posthog.captureServerEvent.mock.calls.map(([, properties]) => [
        properties.code,
        properties.capture_id,
      ])
    ).toEqual([
      ['PIGGYVEST_WEBHOOK_PROCESSING_DEFERRED', CAPTURE_ID],
      ['PIGGYVEST_WEBHOOK_NEEDS_REVIEW', CAPTURE_ID],
    ]);
  });

  it.each([
    ['rejects', () => Promise.reject(new Error('posthog down'))],
    ['never answers', () => new Promise<boolean>(() => {})],
    [
      'throws synchronously',
      () => {
        throw new Error('posthog misconfigured');
      },
    ],
  ])('returns at once and stays silent when PostHog %s', async (_label, failure) => {
    posthog.captureServerEvent.mockImplementation(failure);

    expect(
      alerts.emitPiggyvestWebhookAlert('PIGGYVEST_RESTRICTION_BLOCKED', {
        captureId: CAPTURE_ID,
      })
    ).toBeUndefined();
    await settle();

    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      `[PiggyVest Webhook][ALERT] PIGGYVEST_RESTRICTION_BLOCKED {"captureId":"${CAPTURE_ID}"}`
    );
  });
});
