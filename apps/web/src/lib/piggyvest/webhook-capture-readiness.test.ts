import { beforeEach, describe, expect, it, vi } from 'vitest';

const primary = vi.hoisted(() => ({ bank: '', custody: '', interest: '' }));
const secrets = (key: string) => (key ? { webhookSecret: key } : null);

vi.mock('server-only', () => ({}));
vi.mock('@/lib/piggyvest/primary-wallet-bank-inbox-runtime', () => ({
  readPrimaryWalletBankInboxSecrets: () => secrets(primary.bank),
}));
vi.mock('@/lib/piggyvest/primary-wallet-card-custody-intake-runtime', () => ({
  readPrimaryCardCustodyIntakeSecrets: () => secrets(primary.custody),
}));
vi.mock('@/lib/piggyvest/primary-wallet-paid-interest-inbox-runtime', () => ({
  readPrimaryWalletPaidInterestInboxSecrets: () => secrets(primary.interest),
}));

import { deterministicKeySource } from '@/lib/piggyvest/deterministic-test-data.test-support';
import {
  inspectPiggyvestWebhookCaptureReadiness,
  type WebhookCaptureEvidence,
} from './webhook-capture-readiness';

const freshKey = deterministicKeySource('webhook-capture-readiness');

const NOW = new Date('2026-10-30T12:00:00.000Z');
const MINUTE = 60_000;

let key: string;
let ready: WebhookCaptureEvidence;

// The web app's view: no worker-host evidence, so the attestation is read
// from its own environment.
const onWebApp = (evidence: WebhookCaptureEvidence): WebhookCaptureEvidence => {
  const { drain: _drain, ...web } = evidence;
  return web;
};

beforeEach(() => {
  key = freshKey();
  primary.bank = freshKey();
  primary.custody = freshKey();
  primary.interest = freshKey();
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
    drain: {
      login: { ok: true },
      schedule: { enabled: true, cron: 'installed' },
      primaryIntake: { notReady: [] },
      alerts: { configured: true },
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
      'primary_intake',
      'legacy_replay',
      'migration_and_table',
      'storage',
      'drain_login',
      'drain_schedule',
      'drain_alerts',
      'worker',
    ]);
    expect(report.readyToAttest).toBe(true);
  });

  it('reports every missing piece at once as a clear not-ready list', () => {
    primary.bank = '';
    primary.custody = '';
    primary.interest = '';
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
      'primary_intake:PRIMARY_INTAKE_NOT_CHECKED',
      'migration_and_table:CAPTURE_FUNCTIONS_MISSING',
      'storage:NOT_VERIFIABLE_WITHOUT_MIGRATION',
      'drain_login:DRAIN_LOGIN_NOT_CHECKED',
      'drain_schedule:DRAIN_SCHEDULE_NOT_CHECKED',
      'drain_alerts:DRAIN_ALERTS_NOT_CHECKED',
      'worker:DRAIN_NOT_SCHEDULED',
    ]);
    expect(report.readyToAttest).toBe(false);
  });

  it('requires the dedicated drain login and an enabled, installed schedule', () => {
    ready.drain = {
      login: { ok: false, reason: 'unsafe', failedChecks: ['membership'] },
      schedule: { enabled: false, cron: 'missing' },
      primaryIntake: { notReady: [] },
      alerts: { configured: true },
    };
    expect(notReadyGates(ready)).toEqual([
      'drain_login:DRAIN_LOGIN_UNSAFE',
      'drain_schedule:DRAIN_NOT_ENABLED',
    ]);
    expect(inspectPiggyvestWebhookCaptureReadiness(ready).readyToAttest).toBe(
      false
    );

    ready.drain = {
      login: { ok: true },
      schedule: { enabled: true, cron: 'missing' },
      primaryIntake: { notReady: [] },
      alerts: { configured: true },
    };
    expect(notReadyGates(ready)).toEqual([
      'drain_schedule:DRAIN_CRON_NOT_INSTALLED',
    ]);
  });

  it('is never ready to attest on the web app, where worker-host evidence cannot be collected', () => {
    ready.env = { ...ready.env, PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_SCHEDULED: '' };
    const web = onWebApp(ready);
    const report = inspectPiggyvestWebhookCaptureReadiness(web);
    expect(report.status).toBe('not-ready');
    expect(report.notReady).toContainEqual({
      gate: 'worker',
      reason: 'DRAIN_NOT_SCHEDULED',
    });
    // Worker-host evidence cannot be collected on the web app.
    expect(report.readyToAttest).toBe(false);
  });

  it('does not count an overlap-only key as configuration', () => {
    primary.bank = '';
    primary.custody = '';
    primary.interest = '';
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

  it('names an archive over the per-family cap instead of calling it unreadable', () => {
    const nine = Array.from({ length: 9 }, (_, index) => ({
      version: `old-${index}`,
      family: 'bank',
      secret: `old-secret-${index}`,
      retiredAt: new Date(NOW.getTime() - (200 + index) * MINUTE).toISOString(),
    }));
    ready.env = {
      ...ready.env,
      PIGGYVEST_WEBHOOK_KEY_ARCHIVE: JSON.stringify(nine),
    };
    expect(notReadyGates(ready)).toEqual([
      'key_configuration:KEY_ARCHIVE_FAMILY_CAP_EXCEEDED',
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

  it('requires the drain attestation and a fresh backlog on the web app', () => {
    const workerGate = () =>
      notReadyGates(onWebApp(ready)).filter((gate) =>
        gate.startsWith('worker:')
      );
    ready.env = { ...ready.env, PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_SCHEDULED: '' };
    expect(workerGate()).toEqual(['worker:DRAIN_NOT_SCHEDULED']);

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
    expect(workerGate()).toEqual(['worker:DRAIN_BACKLOG_STALE']);

    if (ready.storage.ok) {
      ready.storage.status.oldestUnprocessedAt = new Date(
        NOW.getTime() - 5 * MINUTE
      ).toISOString();
    }
    expect(workerGate()).toEqual([]);
  });

  it('states which reply a processing failure gets, and that deferred 200 needs the drain', () => {
    const attested = inspectPiggyvestWebhookCaptureReadiness(onWebApp(ready));
    expect(attested.processingFailureReply).toBe('200-deferred');
    expect(attested.notes).toEqual([
      expect.stringContaining(
        'PIGGYVEST_WEBHOOK_CAPTURE_LEGACY_REPLAY_ENABLED'
      ),
    ]);
    expect(attested.notes[0]).toContain(
      'PIGGYVEST_WEBHOOK_CAPTURE_LEGACY_REPLAY_ENABLED'
    );

    ready.env = { ...ready.env, PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_SCHEDULED: '' };
    const unattested = inspectPiggyvestWebhookCaptureReadiness(onWebApp(ready));
    expect(unattested.processingFailureReply).toBe('503-retry');
    expect(unattested.notes).toEqual([
      expect.stringContaining('deferred 200 reply'),
      expect.stringContaining(
        'PIGGYVEST_WEBHOOK_CAPTURE_LEGACY_REPLAY_ENABLED'
      ),
    ]);
    expect(unattested.notes[0]).toContain('is only active once the drain');
    expect(unattested.notes[0]).toContain(
      'PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_SCHEDULED=true'
    );
    expect(unattested.notes[0]).toContain('503');
    // Still not ready: the worker gate is what the note explains.
    expect(unattested.notReady.map((entry) => entry.gate)).toContain('worker');
  });

  it.each([
    'TRUE',
    '1',
    'yes',
  ])('does not count %s as an attested drain', (value) => {
    ready.env = {
      ...ready.env,
      PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_SCHEDULED: value,
    };
    const report = inspectPiggyvestWebhookCaptureReadiness(onWebApp(ready));
    expect(report.processingFailureReply).toBe('503-retry');
    expect(report.notReady).toContainEqual({
      gate: 'worker',
      reason: 'DRAIN_NOT_SCHEDULED',
    });
  });

  it('is advisory only and never exposes key material', () => {
    const report = inspectPiggyvestWebhookCaptureReadiness(ready);
    expect(report.enforced).toBe(false);
    for (const secret of [key, primary.bank, primary.custody, primary.interest])
      expect(JSON.stringify(report)).not.toContain(secret);
  });
});
