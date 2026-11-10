import { beforeEach, describe, expect, it, vi } from 'vitest';

const primary = vi.hoisted(() => ({ bank: '', custody: '', interest: '' }));
const runtime = vi.hoisted(() => ({ inflow: vi.fn() }));
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
vi.mock('@/lib/piggyvest/primary-wallet-inflow-runtime', () => ({
  readPrimaryWalletInflowRuntime: runtime.inflow,
}));

import { deterministicKeySource } from '@/lib/piggyvest/deterministic-test-data.test-support';
import {
  inspectPiggyvestWebhookCaptureReadiness,
  type WebhookCaptureEvidence,
} from './webhook-capture-readiness';

const freshKey = deterministicKeySource('webhook-capture-readiness-legacy');
const NOW = new Date('2026-10-30T12:00:00.000Z');

let ready: WebhookCaptureEvidence;

beforeEach(() => {
  primary.bank = freshKey();
  primary.custody = freshKey();
  primary.interest = freshKey();
  runtime.inflow.mockReturnValue(null);
  ready = {
    env: {
      NODE_ENV: 'test',
      PIGGYVEST_SECRET_KEY: freshKey(),
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
        lastCapturedAt: new Date(NOW.getTime() - 60_000).toISOString(),
        lastProcessedAt: new Date(NOW.getTime() - 60_000).toISOString(),
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

describe('inspectPiggyvestWebhookCaptureReadiness legacy lane', () => {
  it('checks only the legacy key and restricted intake runtime for the opt-in legacy lane', () => {
    primary.bank = '';
    primary.custody = '';
    primary.interest = '';
    ready.env = {
      ...ready.env,
      PIGGYVEST_WEBHOOK_CAPTURE_LEGACY_REPLAY_ENABLED: 'true',
    };
    ready.drain = {
      login: { ok: true },
      schedule: { enabled: true, cron: 'installed' },
      legacyReplayRuntimeReady: true,
      primaryIntake: { notReady: ['bank', 'custody', 'interest'] },
      alerts: { configured: true },
    };
    expect(inspectPiggyvestWebhookCaptureReadiness(ready)).toMatchObject({
      status: 'ready',
      readyToAttest: true,
      notReady: [],
    });

    primary.bank = freshKey();
    expect(notReadyGates(ready)).toContain(
      'primary_intake:PRIMARY_INTAKE_NOT_READY:bank'
    );
    primary.bank = '';

    if (ready.drain) ready.drain.legacyReplayRuntimeReady = false;
    expect(notReadyGates(ready)).toContain(
      'legacy_replay:LEGACY_INTAKE_RUNTIME_NOT_READY'
    );
  });

  it('fails the legacy primary gate for broken enabled bank inflows without bank keys', () => {
    primary.bank = '';
    primary.custody = '';
    primary.interest = '';
    ready.env = {
      ...ready.env,
      PIGGYVEST_WEBHOOK_CAPTURE_LEGACY_REPLAY_ENABLED: 'true',
    };
    ready.drain = {
      login: { ok: true },
      schedule: { enabled: true, cron: 'installed' },
      legacyReplayRuntimeReady: true,
      primaryIntake: { notReady: [], legacyBankInflowUnavailable: true },
      alerts: { configured: true },
    };
    expect(notReadyGates(ready)).toContain(
      'primary_intake:PRIMARY_INTAKE_NOT_READY:bank'
    );
  });

  it('keeps the legacy primary gate ready when bank inflows are deliberately off', () => {
    primary.bank = '';
    primary.custody = '';
    primary.interest = '';
    ready.env = {
      ...ready.env,
      PIGGYVEST_WEBHOOK_CAPTURE_LEGACY_REPLAY_ENABLED: 'true',
    };
    ready.drain = {
      login: { ok: true },
      schedule: { enabled: true, cron: 'installed' },
      legacyReplayRuntimeReady: true,
      primaryIntake: { notReady: [] },
      alerts: { configured: true },
    };
    runtime.inflow.mockReturnValue(null);
    expect(notReadyGates(ready)).not.toContain(
      'primary_intake:PRIMARY_INTAKE_NOT_READY:bank'
    );
  });
});
