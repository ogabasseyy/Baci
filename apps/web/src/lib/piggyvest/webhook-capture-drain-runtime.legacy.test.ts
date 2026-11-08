import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ dispatch: vi.fn(), bankKey: '' }));
vi.mock('server-only', () => ({}));
vi.mock('pg', () => ({ Client: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: vi.fn() }));
vi.mock('@/app/api/webhooks/piggyvest/primary-webhook-dispatch', () => ({
  dispatchPrimaryPiggyvestIntake: mocks.dispatch,
  isKillSwitchDeferral: () => false,
}));
vi.mock('@/lib/piggyvest/primary-wallet-bank-inbox-runtime', () => ({
  readPrimaryWalletBankInboxSecrets: () =>
    mocks.bankKey
      ? { webhookSecret: mocks.bankKey, retainedWebhookSecrets: [] }
      : null,
}));
vi.mock('@/lib/piggyvest/primary-wallet-card-custody-intake-runtime', () => ({
  readPrimaryCardCustodyIntakeSecrets: () => null,
}));
vi.mock('@/lib/piggyvest/primary-wallet-paid-interest-inbox-runtime', () => ({
  readPrimaryWalletPaidInterestInboxSecrets: () => null,
}));

import { deterministicTestKey } from './deterministic-test-data.test-support';
import type {
  ReplayDelivery,
  ReplayProcessResult,
} from './webhook-capture-drain';
import { schemaValidInflow } from './webhook-capture-drain.test-support';
import { runPiggyvestWebhookCaptureDrain } from './webhook-capture-drain-runtime';
import type { CaptureDrainExecutor } from './webhook-capture-pg-executor';
import { createStatefulCaptureExecutor } from './webhook-capture-pg-executor.test-support';

const LEGACY_KEY = deterministicTestKey('legacy-runtime:legacy');
const BANK_KEY = deterministicTestKey('legacy-runtime:bank');
const BASE_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  PIGGYVEST_SECRET_KEY: LEGACY_KEY,
  PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_ENABLED: 'true',
  PIGGYVEST_PRIMARY_DB_HOST: 'db.example.supabase.co',
  PIGGYVEST_PRIMARY_DB_PORT: '5432',
  PIGGYVEST_PRIMARY_DB_NAME: 'postgres',
  PIGGYVEST_PRIMARY_DB_CA: 'synthetic-ca',
  PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_DB_PASSWORD: 'drain-password',
};
const START = Date.parse('2026-11-07T12:00:00.000Z');
let clock = START;

function makeStore() {
  const model = createStatefulCaptureExecutor(() => clock);
  const add = (id: string, key: string, families: ('legacy' | 'bank')[]) => {
    const body = schemaValidInflow(id);
    return model.insert({
      raw_hex: Buffer.from(body).toString('hex'),
      signature: createHmac('sha512', key).update(body).digest('hex'),
      key_families: families,
      event_type: 'bank-transfer.inflow.success',
    });
  };
  return { ...model, add };
}

const run = (
  executor: CaptureDrainExecutor,
  env: NodeJS.ProcessEnv,
  process?: (delivery: ReplayDelivery) => Promise<ReplayProcessResult>
) =>
  runPiggyvestWebhookCaptureDrain({
    env,
    deps: {
      createExecutor: () => executor,
      now: () => new Date(clock),
      primaryIntake: () => ({ notReady: [] }),
      ...(process ? { process } : {}),
    },
  });

beforeEach(() => {
  vi.clearAllMocks();
  clock = START;
  mocks.bankKey = BANK_KEY;
  mocks.dispatch.mockResolvedValue(null);
});

describe('legacy replay runtime lane', () => {
  it('keeps legacy replay off by default and leaves legacy rows for review', async () => {
    const model = makeStore();
    const row = model.add('off', LEGACY_KEY, ['legacy']);
    clock += 121_000;
    const result = await run(model.executor, BASE_ENV);
    expect(result).toMatchObject({
      status: 'drained',
      summary: { needsReview: 1 },
    });
    expect(model.rows.find((entry) => entry.id === row.id)).toMatchObject({
      processing_state: 'needs_review',
      last_error: 'REPLAY_OUT_OF_SCOPE_LEGACY_FAMILY',
    });
  });

  it('requires the restricted intake runtime only when legacy replay is enabled', async () => {
    const model = makeStore();
    await expect(
      run(model.executor, {
        ...BASE_ENV,
        PIGGYVEST_WEBHOOK_CAPTURE_LEGACY_REPLAY_ENABLED: 'true',
      })
    ).resolves.toEqual({ status: 'legacy_intake_not_ready' });
  });

  it('defers a recorded unavailable primary owner while processing legacy bank rows', async () => {
    const model = makeStore();
    const primary = model.add('primary-bank', BANK_KEY, ['bank']);
    const legacy = model.add('legacy-bank', LEGACY_KEY, ['legacy']);
    clock += 121_000;
    const process = vi.fn(async () => ({ status: 200 }));
    const result = await runPiggyvestWebhookCaptureDrain({
      env: {
        ...BASE_ENV,
        PIGGYVEST_WEBHOOK_CAPTURE_LEGACY_REPLAY_ENABLED: 'true',
        PIGGYVEST_WEBHOOK_INTAKE_DB_PASSWORD: 'restricted-intake-password',
      },
      deps: {
        createExecutor: () => model.executor,
        now: () => new Date(clock),
        primaryIntake: () => ({ notReady: ['bank', 'custody', 'interest'] }),
        process,
      },
    });
    expect(result).toMatchObject({
      status: 'drained',
      summary: { processed: 1, retried: 1 },
    });
    expect(process).toHaveBeenCalledOnce();
    expect(model.rows.find((entry) => entry.id === primary.id)).toMatchObject({
      processing_state: 'pending',
      last_error: 'PRIMARY_INTAKE_UNAVAILABLE',
      config_deferrals: 1,
    });
    expect(model.rows.find((entry) => entry.id === legacy.id)).toMatchObject({
      processing_state: 'processed',
    });
  });
});
