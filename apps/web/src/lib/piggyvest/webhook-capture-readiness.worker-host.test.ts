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

/**
 * Readiness as the worker host reports it (`--readiness` on the VPS): it
 * cannot see the web app's attestation, so it never claims to, and it
 * checks what only the host can get wrong (its own family keys, alert
 * delivery, and whether its drain keeps the backlog fresh).
 */
const freshKey = deterministicKeySource('webhook-capture-readiness:host');
const NOW = new Date('2026-10-30T12:00:00.000Z');
const MINUTE = 60_000;

let host: WebhookCaptureEvidence;

const gates = (evidence: WebhookCaptureEvidence) =>
  inspectPiggyvestWebhookCaptureReadiness(evidence).notReady.map(
    (entry) => `${entry.gate}:${entry.reason}`
  );

function staleBacklog(minutes: number) {
  if (!host.storage.ok) throw new Error('storage fixture must be ok');
  host.storage.status.pending = 3;
  host.storage.status.oldestUnprocessedAt = new Date(
    NOW.getTime() - minutes * MINUTE
  ).toISOString();
}

beforeEach(() => {
  primary.bank = freshKey();
  primary.custody = freshKey();
  primary.interest = freshKey();
  host = {
    env: { NODE_ENV: 'test' },
    now: NOW,
    storage: {
      ok: true,
      status: {
        pending: 0,
        claimed: 0,
        needsReview: 0,
        oldestUnprocessedAt: null,
        lastCapturedAt: null,
        lastProcessedAt: null,
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

describe('worker-host readiness', () => {
  it('is ready to attest when every host gate passes, whatever the web flag says here', () => {
    for (const flag of [undefined, 'true']) {
      host.env = {
        NODE_ENV: 'test',
        PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_SCHEDULED: flag,
      };
      const report = inspectPiggyvestWebhookCaptureReadiness(host);
      expect(report).toMatchObject({
        status: 'ready',
        readyToAttest: true,
        processingFailureReply: 'unknown',
        notReady: [],
      });
      expect(report.notes[0]).toContain('cannot be read here');
    }
  });

  it.each([
    ['bank', 'DRAIN_FAMILY_KEY_MISSING:bank'],
    ['interest', 'DRAIN_FAMILY_KEY_MISSING:interest'],
  ] as const)('is not ready to attest without the %s key the drain replays', (family, reason) => {
    primary[family] = '';
    expect(gates(host)).toEqual([`key_configuration:${reason}`]);
    expect(inspectPiggyvestWebhookCaptureReadiness(host).readyToAttest).toBe(
      false
    );
  });

  it('names every missing family at once, and a legacy key never stands in', () => {
    primary.custody = '';
    primary.interest = '';
    host.env = { ...host.env, PIGGYVEST_SECRET_KEY: freshKey() };
    expect(gates(host)).toEqual([
      'key_configuration:DRAIN_FAMILY_KEY_MISSING:custody,interest',
    ]);
  });

  it.each([
    [['bank'], 'PRIMARY_INTAKE_NOT_READY:bank'],
    [['custody', 'interest'], 'PRIMARY_INTAKE_NOT_READY:custody,interest'],
    [
      ['bank', 'custody', 'interest'],
      'PRIMARY_INTAKE_NOT_READY:bank,custody,interest',
    ],
  ] as const)('is not ready to attest while the primary intake of %j cannot finish a replay', (notReady, reason) => {
    // Signing keys, the drain login and an empty backlog all pass: with an
    // intake disabled on this host every replay of its family answers 503,
    // so attesting would stop the provider's retries for nothing.
    if (host.drain) host.drain.primaryIntake = { notReady: [...notReady] };
    expect(gates(host)).toEqual([`primary_intake:${reason}`]);
    const report = inspectPiggyvestWebhookCaptureReadiness(host);
    expect(report).toMatchObject({ status: 'not-ready', readyToAttest: false });
  });

  it('is not ready to attest while the drain alerts cannot leave the host', () => {
    if (host.drain) host.drain.alerts = { configured: false };
    expect(gates(host)).toEqual(['drain_alerts:DRAIN_ALERTS_NOT_CONFIGURED']);
    expect(inspectPiggyvestWebhookCaptureReadiness(host).readyToAttest).toBe(
      false
    );
  });

  it('flags a stale backlog whenever the drain is enabled, even before the web attestation', () => {
    staleBacklog(16);
    expect(gates(host)).toEqual(['worker:DRAIN_BACKLOG_STALE']);
    expect(inspectPiggyvestWebhookCaptureReadiness(host).readyToAttest).toBe(
      false
    );

    staleBacklog(5);
    expect(gates(host)).toEqual([]);
  });

  it('does not judge the backlog while the drain is off on this host', () => {
    staleBacklog(60);
    if (host.drain) host.drain.schedule = { enabled: false, cron: 'installed' };
    expect(gates(host)).toEqual(['drain_schedule:DRAIN_NOT_ENABLED']);
  });
});
