import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  pgClient: vi.fn(),
  createServiceClient: vi.fn(),
  createAdminClient: vi.fn(),
  createIntakeClient: vi.fn(),
  bankKey: '',
}));

vi.mock('server-only', () => ({}));
vi.mock('pg', () => ({ Client: mocks.pgClient }));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: mocks.createServiceClient,
}));
vi.mock('@/lib/supabase/admin', () => ({
  createClient: mocks.createAdminClient,
  createAdminClient: mocks.createAdminClient,
}));
vi.mock('@/lib/piggyvest/server-intake-client', () => ({
  createPiggyvestIntakeClient: mocks.createIntakeClient,
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
vi.mock('@/lib/piggyvest/primary-wallet-paid-interest-inbox-runtime', () => ({
  readPrimaryWalletPaidInterestInboxSecrets: () => null,
}));

import { deterministicTestKey } from './deterministic-test-data.test-support';
import { schemaValidInflow } from './webhook-capture-drain.test-support';
import {
  isPiggyvestCaptureDrainEnabled,
  readPiggyvestCaptureDrainRuntime,
  runPiggyvestWebhookCaptureDrain,
} from './webhook-capture-drain-runtime';
import type { CaptureDrainExecutor } from './webhook-capture-pg-executor';
import { createStatefulCaptureExecutor } from './webhook-capture-pg-executor.test-support';
import type { PrimaryIntakeEvidence } from './webhook-capture-primary-intake-readiness';

const T0 = Date.parse('2026-10-30T12:00:00.000Z');
const SECOND = 1000;
const legacyKey = deterministicTestKey('drain-runtime:legacy');
mocks.bankKey = deterministicTestKey('drain-runtime:bank');

const ENV: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  PIGGYVEST_SECRET_KEY: legacyKey,
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
let credits: Map<string, number>;
let duplicates: number;
let alerts: ReturnType<typeof vi.spyOn>;

function store() {
  const model = createStatefulCaptureExecutor(() => now);
  const add = (
    eventId: string,
    eventType: string,
    key: string,
    families: ('legacy' | 'bank')[]
  ) => {
    const text = schemaValidInflow(eventId, eventType);
    return model.insert({
      raw_hex: Buffer.from(text).toString('hex'),
      signature: sign(key, text),
      key_families: families,
      event_type: eventType,
    });
  };
  return { ...model, add };
}

const run = (executor: CaptureDrainExecutor, env = ENV) =>
  runPiggyvestWebhookCaptureDrain({
    env,
    deps: {
      createExecutor: () => executor,
      now: () => new Date(now),
      primaryIntake: () => ({ notReady: [] }),
    },
  });

beforeEach(() => {
  vi.clearAllMocks();
  now = T0;
  credits = new Map();
  duplicates = 0;
  alerts = vi.spyOn(console, 'error').mockImplementation(() => {});
  // A downstream ledger keyed on the provider transaction id, as the real
  // primary intakes are: a replay applies each transaction once and answers
  // a duplicate after that.
  mocks.dispatch.mockImplementation(
    async ({ rawBody }: { rawBody: Buffer }) => {
      const id: string = JSON.parse(rawBody.toString()).eventData
        .transaction_id;
      if (credits.has(id)) duplicates += 1;
      else credits.set(id, 1);
      return new Response('{}', { status: 200 });
    }
  );
});

describe('enable flag and configuration', () => {
  it.each([
    undefined,
    '',
    'TRUE',
    '1',
    'false',
  ])('opens no connection and reads nothing when the flag is %s', async (flag) => {
    const createExecutor = vi.fn();
    const result = await runPiggyvestWebhookCaptureDrain({
      env: { ...ENV, PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_ENABLED: flag },
      deps: { createExecutor },
    });
    expect(result).toEqual({ status: 'disabled' });
    expect(createExecutor).not.toHaveBeenCalled();
    expect(mocks.pgClient).not.toHaveBeenCalled();
    expect(
      isPiggyvestCaptureDrainEnabled({
        NODE_ENV: 'test',
        PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_ENABLED: flag,
      })
    ).toBe(false);
  });

  it('only monitors review metadata without claiming while every intake is not ready', async () => {
    const model = createStatefulCaptureExecutor(() => T0);
    const query = vi.spyOn(model.executor, 'query');
    const createExecutor = vi.fn(() => model.executor);
    const primaryIntake = vi.fn(
      (): PrimaryIntakeEvidence => ({
        notReady: ['bank', 'custody', 'interest'],
      })
    );
    await expect(
      runPiggyvestWebhookCaptureDrain({
        env: ENV,
        deps: { createExecutor, primaryIntake, now: () => new Date(T0) },
      })
    ).resolves.toEqual({
      status: 'intake_not_ready',
      notReady: ['bank', 'custody', 'interest'],
    });
    expect(primaryIntake).toHaveBeenCalledWith(ENV, new Date(T0));
    expect(query).toHaveBeenCalledExactlyOnceWith('status', []);
    expect(mocks.pgClient).not.toHaveBeenCalled();
  });

  it('fails closed without opening a connection when the login is not configured', async () => {
    const createExecutor = vi.fn();
    const env = { ...ENV, PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_DB_PASSWORD: '' };
    await expect(
      runPiggyvestWebhookCaptureDrain({ env, deps: { createExecutor } })
    ).resolves.toEqual({ status: 'unconfigured' });
    expect(createExecutor).not.toHaveBeenCalled();
    expect(mocks.pgClient).not.toHaveBeenCalled();
  });

  it('binds the fixed drain login, never one named by the environment', () => {
    expect(
      readPiggyvestCaptureDrainRuntime({
        ...ENV,
        PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_DB_LOGIN: 'service_role',
      })
    ).toMatchObject({
      database: { login: 'baci_piggyvest_webhook_capture_drain', port: 5432 },
    });
    expect(
      readPiggyvestCaptureDrainRuntime({ ...ENV, PIGGYVEST_PRIMARY_DB_CA: '' })
    ).toBeNull();
  });
});

describe('worker-host replay', () => {
  it('replays primary rows, sets legacy-family rows aside with an alert, and never builds a service client', async () => {
    const model = store();
    const primary = model.add(
      'p1',
      'bank-transfer.inflow.success',
      mocks.bankKey,
      ['bank']
    );
    const legacy = model.add('l1', 'bank-transfer.inflow.success', legacyKey, [
      'legacy',
    ]);
    now += 121 * SECOND;

    const result = await run(model.executor);

    expect(result).toEqual({
      status: 'drained',
      summary: { claimed: 2, processed: 1, retried: 0, needsReview: 1 },
    });
    expect(model.rows.find((r) => r.id === primary.id)).toMatchObject({
      processing_state: 'processed',
    });
    expect(model.rows.find((r) => r.id === legacy.id)).toMatchObject({
      processing_state: 'needs_review',
      last_error: 'REPLAY_OUT_OF_SCOPE_LEGACY_FAMILY',
    });
    // A provider redelivery the receiver completes inline still closes it.
    expect(model.completeInline(legacy.id)).toBe(true);
    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    expect(credits).toEqual(new Map([['txn-p1', 1]]));
    const deferral = alerts.mock.calls
      .map((call: unknown[]) => String(call[0]))
      .find((line: string) => line.includes(legacy.id));
    expect(deferral).toContain('PIGGYVEST_WEBHOOK_REPLAY_DEFERRED');
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.createIntakeClient).not.toHaveBeenCalled();
    expect(mocks.pgClient).not.toHaveBeenCalled();
  });

  it('processes a row once after a crash: the expired lease is re-claimed and the replay is idempotent', async () => {
    const model = store();
    const row = model.add('c1', 'bank-transfer.inflow.success', mocks.bankKey, [
      'bank',
    ]);
    let crashed = true;
    const crashing: CaptureDrainExecutor = {
      ...model.executor,
      async query(statement, parameters) {
        // The worker dies after processing, before it can settle the row.
        if (statement === 'resolve' && parameters[2] !== 'renew' && crashed)
          throw new Error('worker killed');
        return model.executor.query(statement, parameters);
      },
    };

    now += 121 * SECOND;
    await run(crashing);
    expect(model.rows[0]).toMatchObject({
      processing_state: 'claimed',
      attempts: 1,
    });

    crashed = false;
    now += 60 * SECOND; // still leased: no second worker may take it
    await expect(run(crashing)).resolves.toMatchObject({
      summary: { claimed: 0 },
    });

    now += 241 * SECOND; // lease (300 s) has expired
    await expect(run(crashing)).resolves.toMatchObject({
      summary: { claimed: 1, processed: 1 },
    });

    expect(model.rows[0]).toMatchObject({
      id: row.id,
      processing_state: 'processed',
      attempts: 2,
    });
    expect(mocks.dispatch).toHaveBeenCalledTimes(2);
    // Two replays, but the ledger keyed on the transaction id applied it
    // once (R5: a crash after capture is replayed idempotently).
    expect(credits).toEqual(new Map([['txn-c1', 1]]));
    expect(duplicates).toBe(1);
    await expect(run(crashing)).resolves.toMatchObject({
      summary: { claimed: 0 },
    });
  });
});
