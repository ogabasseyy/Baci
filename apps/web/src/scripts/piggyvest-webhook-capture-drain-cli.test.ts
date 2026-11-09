import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  execFile: vi.fn(),
  primaryKeys: { bank: '', custody: '', interest: '' },
  intakesNotReady: [] as string[],
}));
const secrets = (key: string) => (key ? { webhookSecret: key } : null);

vi.mock('server-only', () => ({}));
vi.mock('dotenv/config', () => ({}));
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    default: { ...actual, execFile: mocks.execFile },
    execFile: mocks.execFile,
  };
});
vi.mock('@/app/api/webhooks/piggyvest/primary-webhook-dispatch', () => ({
  dispatchPrimaryPiggyvestIntake: mocks.dispatch,
}));
vi.mock('@/lib/piggyvest/primary-wallet-bank-inbox-runtime', () => ({
  readPrimaryWalletBankInboxSecrets: () => secrets(mocks.primaryKeys.bank),
}));
vi.mock('@/lib/piggyvest/primary-wallet-card-custody-intake-runtime', () => ({
  readPrimaryCardCustodyIntakeSecrets: () =>
    secrets(mocks.primaryKeys.custody),
}));
vi.mock('@/lib/piggyvest/primary-wallet-paid-interest-inbox-runtime', () => ({
  readPrimaryWalletPaidInterestInboxSecrets: () =>
    secrets(mocks.primaryKeys.interest),
}));

vi.mock(
  '@/lib/piggyvest/webhook-capture-primary-intake-readiness',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('@/lib/piggyvest/webhook-capture-primary-intake-readiness')
    >()),
    // The real readers need a full intake configuration; their own suites
    // cover them. Here the host either has every intake or lacks some.
    collectPrimaryIntakeEvidence: () => ({ notReady: mocks.intakesNotReady }),
  })
);

import { deterministicTestKey } from '@/lib/piggyvest/deterministic-test-data.test-support';
import type { CaptureDrainExecutor } from '@/lib/piggyvest/webhook-capture-pg-executor';
import { scriptedCaptureExecutor } from '@/lib/piggyvest/webhook-capture-pg-executor.test-support';
import {
  readInstalledCrontab,
  runPiggyvestWebhookCaptureDrainCli,
} from './piggyvest-webhook-capture-drain-cli';

const PASSWORD = 'drain-password-never-printed';
const KEY = deterministicTestKey('capture-drain-cli');
const ENV: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  PIGGYVEST_SECRET_KEY: KEY,
  PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_ENABLED: 'true',
  PIGGYVEST_PRIMARY_DB_HOST: 'db.example.supabase.co',
  PIGGYVEST_PRIMARY_DB_PORT: '5432',
  PIGGYVEST_PRIMARY_DB_NAME: 'postgres',
  PIGGYVEST_PRIMARY_DB_CA: 'placeholder-ca',
  PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_DB_PASSWORD: PASSWORD,
  POSTHOG_PROJECT_TOKEN: 'placeholder-posthog-project-token',
};
const PRIMARY_KEYS = {
  bank: deterministicTestKey('capture-drain-cli:bank'),
  custody: deterministicTestKey('capture-drain-cli:custody'),
  interest: deterministicTestKey('capture-drain-cli:interest'),
};
const CRON = `* * * * * flock -n /w/locks/piggyvest-webhook-capture-drain.lock bash -lc 'export NODE_ENV=production && export BACI_WORKER_PROFILE=piggyvest-webhook-capture-drain && cd /w && timeout --verbose --signal=TERM --kill-after=10s 50s /w/bin/process-piggyvest-webhook-capture-drain.sh --once' >> /w/logs/piggyvest-webhook-capture-drain.log 2>&1`;

let output: string[];
let createExecutor: ReturnType<typeof vi.fn<(runtime: unknown) => CaptureDrainExecutor>>;

const cli = (argv: string[], env: NodeJS.ProcessEnv = ENV, crontab = CRON) =>
  runPiggyvestWebhookCaptureDrainCli({
    argv,
    env,
    write: (text) => output.push(text),
    deps: { createExecutor, readCrontab: async () => crontab },
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.primaryKeys = { bank: '', custody: '', interest: '' };
  mocks.intakesNotReady = [];
  output = [];
  createExecutor = vi.fn(() => scriptedCaptureExecutor([]));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('runPiggyvestWebhookCaptureDrainCli', () => {
  it('prints the plan without reading configuration or connecting', async () => {
    await expect(cli(['--plan'], { NODE_ENV: 'test' })).resolves.toBe(0);
    expect(output[0]).toContain('Plan only');
    expect(createExecutor).not.toHaveBeenCalled();
  });

  it.each([[[]], [['--once', '--plan']], [['--loop']]])('rejects %j without running', async (argv) => {
    await expect(cli(argv)).resolves.toBe(1);
    expect(createExecutor).not.toHaveBeenCalled();
  });

  it('is a no-op with no connection while the host flag is off', async () => {
    const env = { ...ENV, PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_ENABLED: 'false' };
    await expect(cli(['--once'], env)).resolves.toBe(0);
    expect(output).toEqual(['{"status":"disabled"}']);
    expect(createExecutor).not.toHaveBeenCalled();
  });

  it('fails closed when the drain login is not configured', async () => {
    const env = { ...ENV, PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_DB_PASSWORD: '' };
    await expect(cli(['--once'], env)).resolves.toBe(1);
    expect(output[0]).toContain('not configured');
    expect(createExecutor).not.toHaveBeenCalled();
  });

  it('runs one bounded pass and prints counts only', async () => {
    const claims: unknown[] = [];
    createExecutor.mockImplementation(() => {
      const executor = scriptedCaptureExecutor([]);
      return {
        ...executor,
        query: async (statement, parameters) => {
          if (statement === 'claim') claims.push(parameters);
          return executor.query(statement, parameters);
        },
      };
    });
    await expect(cli(['--once'])).resolves.toBe(0);
    expect(claims).toEqual([[1, 300, 120]]);
    expect(JSON.parse(output[0] ?? '')).toEqual({
      status: 'drained',
      claimed: 0,
      processed: 0,
      retried: 0,
      needsReview: 0,
    });
  });

  it('fails closed without claiming when the enabled legacy intake is unconfigured', async () => {
    mocks.intakesNotReady = ['bank', 'custody', 'interest'];
    const claims: unknown[] = [];
    createExecutor.mockImplementation(() => {
      const executor = scriptedCaptureExecutor([]);
      return { ...executor, query: async (statement, parameters) => {
        if (statement === 'claim') claims.push(parameters);
        return executor.query(statement, parameters);
      } };
    });
    await expect(cli(['--once'], {
      ...ENV,
      PIGGYVEST_WEBHOOK_CAPTURE_LEGACY_REPLAY_ENABLED: 'true',
    })).resolves.toBe(1);
    expect(output).toEqual(['{"status":"legacy_intake_not_ready"}']);
    expect(createExecutor).toHaveBeenCalledOnce();
    expect(claims).toEqual([]);
  });

  it('does not claim anything while all primary intakes are not ready', async () => {
    mocks.intakesNotReady = ['bank', 'custody', 'interest'];
    await expect(cli(['--once'])).resolves.toBe(1);
    expect(JSON.parse(output[0] ?? '')).toEqual({
      status: 'intake_not_ready',
      notReady: ['bank', 'custody', 'interest'],
    });
    expect(createExecutor).toHaveBeenCalledOnce();
  });

  it('redacts a database failure and says the rows stay pending', async () => {
    createExecutor.mockImplementation(() => ({
      query: async () => {
        throw new Error(`password ${PASSWORD} rejected by db.example.supabase.co`);
      },
      verifySession: async () => ({ ok: true }),
    }));
    await expect(cli(['--once'])).resolves.toBe(1);
    expect(output.join('\n')).not.toMatch(new RegExp(`${PASSWORD}|db\\.example`));
    expect(output[0]).toContain('stay pending');
  });

  it('prints a readiness report with no secrets and passes once every host gate does', async () => {
    mocks.primaryKeys = { ...PRIMARY_KEYS };
    await expect(cli(['--readiness'])).resolves.toBe(0);
    const report = JSON.parse(output[0] ?? '');
    expect(report.readyToAttest).toBe(true);
    expect(report.notReady).toEqual([]);
    for (const secret of [PASSWORD, KEY, ...Object.values(PRIMARY_KEYS)])
      expect(output[0]).not.toContain(secret);
  });

  it('is not ready to attest on a host that holds no key of a family the drain replays', async () => {
    // Only the legacy key: the host could not verify a single row it replays.
    await expect(cli(['--readiness'])).resolves.toBe(1);
    const report = JSON.parse(output[0] ?? '');
    expect(report.readyToAttest).toBe(false);
    expect(report.notReady).toEqual([
      {
        gate: 'key_configuration',
        reason: 'DRAIN_FAMILY_KEY_MISSING:bank,custody,interest',
      },
    ]);
  });

  it('is not ready to attest while a primary intake it replays through is not enabled on the host', async () => {
    // Keys, login, schedule and alerts all pass; the bank intake does not.
    mocks.primaryKeys = { ...PRIMARY_KEYS };
    mocks.intakesNotReady = ['bank'];
    await expect(cli(['--readiness'])).resolves.toBe(1);
    const report = JSON.parse(output[0] ?? '');
    expect(report.readyToAttest).toBe(false);
    expect(report.notReady).toEqual([
      { gate: 'primary_intake', reason: 'PRIMARY_INTAKE_NOT_READY:bank' },
    ]);
  });

  it('is not ready to attest while the drain alerts cannot leave the host', async () => {
    mocks.primaryKeys = { ...PRIMARY_KEYS };
    const env = { ...ENV, POSTHOG_PROJECT_TOKEN: '' };
    await expect(cli(['--readiness'], env)).resolves.toBe(1);
    expect(JSON.parse(output[0] ?? '').notReady).toEqual([
      { gate: 'drain_alerts', reason: 'DRAIN_ALERTS_NOT_CONFIGURED' },
    ]);
  });

  it('reports a missing cron entry as not ready to attest', async () => {
    await expect(cli(['--readiness'], ENV, '')).resolves.toBe(1);
    expect(JSON.parse(output[0] ?? '').notReady).toContainEqual({
      gate: 'drain_schedule',
      reason: 'DRAIN_CRON_NOT_INSTALLED',
    });
  });
});

describe('readInstalledCrontab', () => {
  it('returns the crontab, or null when it cannot be read', async () => {
    mocks.execFile.mockImplementationOnce((_file, _args, _options, callback) =>
      callback(null, CRON, '')
    );
    await expect(readInstalledCrontab()).resolves.toBe(CRON);
    expect(mocks.execFile).toHaveBeenCalledWith(
      'crontab',
      ['-l'],
      expect.objectContaining({ timeout: expect.any(Number) }),
      expect.any(Function)
    );

    mocks.execFile.mockImplementationOnce((_file, _args, _options, callback) =>
      callback(new Error('no crontab for baci-worker'), '', '')
    );
    await expect(readInstalledCrontab()).resolves.toBeNull();
  });
});
