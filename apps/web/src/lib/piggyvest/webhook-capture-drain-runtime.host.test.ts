import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ dispatch: vi.fn(), bankKey: '' }));

vi.mock('server-only', () => ({}));
vi.mock('pg', () => ({ Client: vi.fn() }));
vi.mock('@/lib/posthog/piggyvest-money-alert-events', () => ({
  sendPiggyvestMoneyAlert: vi.fn(async () => 'sent'),
}));
vi.mock('@/app/api/webhooks/piggyvest/primary-webhook-dispatch', () => ({
  dispatchPrimaryPiggyvestIntake: mocks.dispatch,
  isKillSwitchDeferral: () => false,
}));
vi.mock('@/lib/piggyvest/primary-wallet-bank-inbox-runtime', () => ({
  readPrimaryWalletBankInboxSecrets: () => ({
    webhookSecret: mocks.bankKey,
    retainedWebhookSecrets: [],
  }),
}));
vi.mock('@/lib/piggyvest/primary-wallet-card-custody-intake-runtime', () => ({
  readPrimaryCardCustodyIntakeSecrets: () => null,
}));
// The interest family is not configured on this host (for example its
// reader is gated on an environment marker the host does not set).
vi.mock('@/lib/piggyvest/primary-wallet-paid-interest-inbox-runtime', () => ({
  readPrimaryWalletPaidInterestInboxSecrets: () => null,
}));

import { deterministicTestKey } from './deterministic-test-data.test-support';
import { schemaValidInflow } from './webhook-capture-drain.test-support';
import { runPiggyvestWebhookCaptureDrain } from './webhook-capture-drain-runtime';
import { createStatefulCaptureExecutor } from './webhook-capture-pg-executor.test-support';
import type { PrimaryIntakeFamily } from './webhook-capture-primary-intake-readiness';
import { derivePiggyvestKeyVersion } from './webhook-key-archive';
import type { PiggyvestWebhookKeyFamily } from './webhook-secret-union';

/**
 * Worker-host behaviour the drain suites cannot show on their own: rows
 * set aside never come back to crowd out later work, and a row signed by a
 * key this host does not hold waits for configuration instead of being
 * parked as a possible forgery.
 */
const T0 = Date.parse('2026-10-30T12:00:00.000Z');
const SECOND = 1000;
const HOUR = 3600 * SECOND;
const legacyKey = deterministicTestKey('drain-host:legacy');
mocks.bankKey = deterministicTestKey('drain-host:bank');

const ENV: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_ENABLED: 'true',
  PIGGYVEST_PRIMARY_DB_HOST: 'db.example.supabase.co',
  PIGGYVEST_PRIMARY_DB_PORT: '5432',
  PIGGYVEST_PRIMARY_DB_NAME: 'postgres',
  PIGGYVEST_PRIMARY_DB_CA: 'placeholder-ca',
  PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_DB_PASSWORD: 'placeholder-password',
};
const sign = (key: string, text: string) =>
  createHmac('sha512', key).update(text).digest('hex');

let now: number;
let alerts: ReturnType<typeof vi.spyOn>;

function store() {
  const model = createStatefulCaptureExecutor(() => now);
  const add = (
    eventId: string,
    signingKey: string,
    families: PiggyvestWebhookKeyFamily[],
    options: { eventType?: string; keyVersion?: string } = {}
  ) => {
    const eventType = options.eventType ?? 'bank-transfer.inflow.success';
    const text = schemaValidInflow(eventId, eventType);
    return model.insert({
      raw_hex: Buffer.from(text).toString('hex'),
      signature: sign(signingKey, text),
      key_version: options.keyVersion ?? derivePiggyvestKeyVersion(signingKey),
      key_families: families,
      event_type: eventType,
    });
  };
  const run = (notReady: PrimaryIntakeFamily[] = []) =>
    runPiggyvestWebhookCaptureDrain({
      env: ENV,
      deps: {
        createExecutor: () => model.executor,
        now: () => new Date(now),
        primaryIntake: () => ({ notReady }),
      },
    });
  return { ...model, add, run };
}

const alertLines = (): string[] =>
  alerts.mock.calls.map((call: unknown[]) => String(call[0]));

beforeEach(() => {
  vi.clearAllMocks();
  now = T0;
  alerts = vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.dispatch.mockResolvedValue(new Response('{}', { status: 200 }));
});

describe('rows the worker host cannot finish', () => {
  it('recovers bank captures while custody is off and defers custody without spending attempts', async () => {
    const model = store();
    const bank = model.add('ready-bank', mocks.bankKey, ['bank']);
    const custody = model.add('off-custody', legacyKey, ['custody'], {
      eventType: 'wallet-transfer.outflow.success',
    });
    now += 121 * SECOND;
    expect(await model.run(['custody'])).toMatchObject({
      summary: { processed: 1, retried: 1 },
    });
    expect(bank.processing_state).toBe('processed');
    expect(custody).toMatchObject({
      processing_state: 'pending',
      attempts: 0,
      last_error: 'PRIMARY_INTAKE_UNAVAILABLE',
    });
    expect(mocks.dispatch).toHaveBeenCalledOnce();
  });

  it('rediscovers a durable review after its settlement response and alert were lost', async () => {
    const model = store();
    const legacy = model.add('lost-review-response', legacyKey, ['legacy']);
    const reviewAlerts = await import('./webhook-alerts');
    const sendAlert = vi
      .spyOn(reviewAlerts, 'sendPiggyvestWebhookAlertDelivered')
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    const query = model.executor.query.bind(model.executor);
    model.executor.query = async (statement, parameters) => {
      const rows = await query(statement, parameters);
      if (statement === 'resolve' && parameters[2] === 'needs_review')
        throw new Error('response lost after commit');
      return rows;
    };
    now += 121 * SECOND;
    await model.run();
    expect(legacy.processing_state).toBe('needs_review');
    expect(sendAlert).toHaveBeenCalledTimes(1);
    alerts.mockClear();
    await model.run();
    expect(
      alertLines().some((line) =>
        line.includes('captured deliveries remain in needs_review')
      )
    ).toBe(true);
    expect(sendAlert).toHaveBeenCalledTimes(2);
    expect(mocks.dispatch).not.toHaveBeenCalled();
    sendAlert.mockRestore();
  });
  it('never claims a set-aside row again, so a later primary deposit is claimed on the next pass', async () => {
    const model = store();
    const legacy = Array.from({ length: 12 }, (_, index) =>
      model.add(`legacy-${index}`, legacyKey, ['legacy'])
    );
    now += 121 * SECOND;
    await model.run();
    await model.run();
    expect(legacy.every((row) => row.processing_state === 'needs_review')).toBe(
      true
    );

    // Long after any deferral backoff (capped at one hour) would have run
    // out, a primary deposit arrives behind those older rows.
    now += 2 * HOUR;
    const primary = model.add('primary-1', mocks.bankKey, ['bank']);
    now += 121 * SECOND;

    await expect(model.run()).resolves.toEqual({
      status: 'drained',
      summary: { claimed: 1, processed: 1, retried: 0, needsReview: 0 },
    });
    expect(primary.processing_state).toBe('processed');
  });
});

describe('re-verification against the host key set', () => {
  it.each<[string, string, PiggyvestWebhookKeyFamily, string | undefined]>([
    [
      'a bank key the host has not been given yet (rotation lag)',
      deterministicTestKey('drain-host:bank-rotated'),
      'bank',
      undefined,
    ],
    [
      'the interest family, not configured on this host',
      deterministicTestKey('drain-host:interest'),
      'interest',
      'interest-payout.success',
    ],
  ])('defers a row signed with %s instead of parking it', async (_label, signingKey, family, eventType) => {
    const model = store();
    const row = model.add('unheld-1', signingKey, [family], { eventType });
    now += 121 * SECOND;

    await expect(model.run()).resolves.toMatchObject({
      summary: { claimed: 1, retried: 1, needsReview: 0 },
    });
    expect(row).toMatchObject({
      processing_state: 'pending',
      attempts: 0,
      last_error: 'KEYS_UNCONFIGURED',
    });
    expect(mocks.dispatch).not.toHaveBeenCalled();
    const line = alertLines().find((text) => text.includes(row.id));
    expect(line).toContain('PIGGYVEST_WEBHOOK_KEYS_UNCONFIGURED');
    expect(line).not.toContain(signingKey);
    expect(alertLines().join('\n')).not.toContain('REPLAY_UNVERIFIABLE');
  });

  it('defers an interest payout whose shared secret the host has loaded only as the bank key', async () => {
    // The web app holds one secret as both the bank and the interest key,
    // so admission recorded both; this host has not loaded the interest
    // assignment yet. Parking it as authority lost would strand it.
    const model = store();
    const row = model.add('shared-1', mocks.bankKey, ['bank', 'interest'], {
      eventType: 'interest-payout.success',
    });
    now += 121 * SECOND;

    await expect(model.run()).resolves.toMatchObject({
      summary: { claimed: 1, retried: 1, needsReview: 0 },
    });
    expect(row).toMatchObject({
      processing_state: 'pending',
      attempts: 0,
      last_error: 'KEY_SET_INCOMPLETE',
    });
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it('still parks a row whose key version the host holds but whose signature fails', async () => {
    const model = store();
    const row = model.add(
      'forged-1',
      deterministicTestKey('drain-host:not-ours'),
      ['bank'],
      { keyVersion: derivePiggyvestKeyVersion(mocks.bankKey) }
    );
    now += 121 * SECOND;

    await expect(model.run()).resolves.toMatchObject({
      summary: { claimed: 1, needsReview: 1 },
    });
    expect(row).toMatchObject({
      processing_state: 'needs_review',
      last_error: 'REPLAY_SIGNATURE_UNVERIFIABLE',
    });
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
});
