import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/piggyvest/primary-wallet-bank-inbox-runtime', () => ({
  readPrimaryWalletBankInboxSecrets: () => null,
}));
vi.mock('@/lib/piggyvest/primary-wallet-card-custody-intake-runtime', () => ({
  readPrimaryCardCustodyIntakeSecrets: () => null,
}));
vi.mock('@/lib/piggyvest/primary-wallet-paid-interest-inbox-runtime', () => ({
  readPrimaryWalletPaidInterestInboxSecrets: () => null,
}));

import type { PiggyvestIntakeServiceClient } from '@/lib/supabase/service';
import {
  collectPiggyvestWebhookCaptureEvidence,
  inspectPiggyvestWebhookCaptureReadiness,
  type WebhookCaptureEvidence,
} from './webhook-capture-readiness';

const NOW = new Date('2026-10-30T12:00:00.000Z');
const MINUTE = 60_000;

let key: string;
let ready: WebhookCaptureEvidence;

beforeEach(() => {
  key = randomBytes(32).toString('hex');
  ready = {
    env: {
      NODE_ENV: 'test',
      PIGGYVEST_SECRET_KEY: key,
      PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_SCHEDULED: 'true',
    },
    now: NOW,
    storage: {
      ok: true,
      status: {
        pending: 0,
        claimed: 0,
        needsReview: 0,
        oldestUnprocessedAt: null,
        lastCapturedAt: new Date(NOW.getTime() - MINUTE).toISOString(),
        lastProcessedAt: new Date(NOW.getTime() - MINUTE).toISOString(),
      },
    },
  };
});

const notReadyGates = (evidence: WebhookCaptureEvidence) =>
  inspectPiggyvestWebhookCaptureReadiness(evidence).notReady.map(
    (entry) => `${entry.gate}:${entry.reason}`
  );

describe('inspectPiggyvestWebhookCaptureReadiness', () => {
  it('is ready when keys, migration, storage and the drain are all present', () => {
    const report = inspectPiggyvestWebhookCaptureReadiness(ready);
    expect(report.status).toBe('ready');
    expect(report.notReady).toEqual([]);
    expect(report.checks.map((check) => check.gate)).toEqual([
      'key_configuration',
      'migration_and_table',
      'storage',
      'worker',
    ]);
  });

  it('reports every missing piece at once as a clear not-ready list', () => {
    const report = inspectPiggyvestWebhookCaptureReadiness({
      env: { NODE_ENV: 'test' },
      now: NOW,
      storage: { ok: false, reason: 'function_missing' },
    });
    expect(report.status).toBe('not-ready');
    expect(
      report.notReady.map((entry) => `${entry.gate}:${entry.reason}`)
    ).toEqual([
      'key_configuration:NO_CURRENT_KEY',
      'migration_and_table:CAPTURE_FUNCTIONS_MISSING',
      'storage:NOT_VERIFIABLE_WITHOUT_MIGRATION',
      'worker:DRAIN_NOT_SCHEDULED',
    ]);
  });

  it('does not count an overlap-only key as configuration', () => {
    ready.env = {
      ...ready.env,
      PIGGYVEST_SECRET_KEY: '',
      PIGGYVEST_WEBHOOK_KEY_ARCHIVE: JSON.stringify([
        {
          version: 'pv-old',
          family: 'legacy',
          secret: key,
          retiredAt: new Date(NOW.getTime() - MINUTE).toISOString(),
        },
      ]),
    };
    expect(notReadyGates(ready)).toEqual(['key_configuration:NO_CURRENT_KEY']);
  });

  it('flags an unreadable key archive', () => {
    ready.env = { ...ready.env, PIGGYVEST_WEBHOOK_KEY_ARCHIVE: '{broken' };
    expect(notReadyGates(ready)).toEqual([
      'key_configuration:KEY_CONFIGURATION_UNREADABLE',
    ]);
  });

  it('distinguishes unreachable storage from a missing migration', () => {
    ready.storage = { ok: false, reason: 'unreachable' };
    expect(notReadyGates(ready)).toEqual([
      'migration_and_table:NOT_VERIFIABLE_WITHOUT_STORAGE',
      'storage:STORAGE_UNREACHABLE',
    ]);
  });

  it('flags a status response that is not the expected shape', () => {
    ready.storage = { ok: false, reason: 'invalid_response' };
    expect(notReadyGates(ready)).toEqual([
      'migration_and_table:STORAGE_RESPONSE_INVALID',
      'storage:STORAGE_RESPONSE_INVALID',
    ]);
  });

  it('requires the drain attestation and a fresh backlog', () => {
    ready.env = { ...ready.env, PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_SCHEDULED: '' };
    expect(notReadyGates(ready)).toEqual(['worker:DRAIN_NOT_SCHEDULED']);

    ready.env = {
      ...ready.env,
      PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_SCHEDULED: 'true',
    };
    if (ready.storage.ok) {
      ready.storage.status.pending = 4;
      ready.storage.status.oldestUnprocessedAt = new Date(
        NOW.getTime() - 16 * MINUTE
      ).toISOString();
    }
    expect(notReadyGates(ready)).toEqual(['worker:DRAIN_BACKLOG_STALE']);

    if (ready.storage.ok) {
      ready.storage.status.oldestUnprocessedAt = new Date(
        NOW.getTime() - 5 * MINUTE
      ).toISOString();
    }
    expect(notReadyGates(ready)).toEqual([]);
  });

  it('is advisory only and never exposes key material', () => {
    const report = inspectPiggyvestWebhookCaptureReadiness(ready);
    expect(report.enforced).toBe(false);
    expect(JSON.stringify(report)).not.toContain(key);
  });
});

describe('collectPiggyvestWebhookCaptureEvidence', () => {
  const status = {
    pending: 1,
    claimed: 0,
    needsReview: 0,
    oldestUnprocessedAt: null,
    lastCapturedAt: null,
    lastProcessedAt: null,
  };
  const collect = (rpc: () => Promise<{ data: unknown; error: unknown }>) =>
    collectPiggyvestWebhookCaptureEvidence({
      client: { rpc: vi.fn(rpc) } as unknown as PiggyvestIntakeServiceClient,
      env: { NODE_ENV: 'test' },
      now: NOW,
    });

  it('reads the counters through the status function', async () => {
    await expect(
      collect(async () => ({ data: status, error: null }))
    ).resolves.toMatchObject({ storage: { ok: true, status } });
  });

  it.each([
    ['PGRST202', 'function_missing'],
    ['42883', 'function_missing'],
    ['08006', 'unreachable'],
  ])('classifies database error %s as %s', async (code, reason) => {
    await expect(
      collect(async () => ({ data: null, error: { code, message: 'x' } }))
    ).resolves.toMatchObject({ storage: { ok: false, reason } });
  });

  it('treats a thrown transport error as unreachable and a bad shape as invalid', async () => {
    await expect(
      collect(async () => {
        throw new Error('socket closed');
      })
    ).resolves.toMatchObject({ storage: { ok: false, reason: 'unreachable' } });
    await expect(
      collect(async () => ({ data: { nope: true }, error: null }))
    ).resolves.toMatchObject({
      storage: { ok: false, reason: 'invalid_response' },
    });
  });
});
