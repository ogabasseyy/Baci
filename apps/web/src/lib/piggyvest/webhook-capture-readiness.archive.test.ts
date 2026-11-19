import { describe, expect, it, vi } from 'vitest';

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

import { deterministicTestKey } from './deterministic-test-data.test-support';
import {
  inspectPiggyvestWebhookCaptureReadiness,
  type WebhookCaptureEvidence,
} from './webhook-capture-readiness';

describe('archived primary signing families in legacy replay readiness', () => {
  it.each([
    'bank',
    'custody',
    'interest',
  ] as const)('requires the %s intake even when its only signing key is replay-only', (family) => {
    const evidence: WebhookCaptureEvidence = {
      now: new Date('2026-11-08T12:00:00Z'),
      env: {
        NODE_ENV: 'test',
        PIGGYVEST_SECRET_KEY: deterministicTestKey('archive:current-legacy'),
        PIGGYVEST_WEBHOOK_CAPTURE_LEGACY_REPLAY_ENABLED: 'true',
        PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_SCHEDULED: 'true',
        PIGGYVEST_WEBHOOK_KEY_ARCHIVE: JSON.stringify([
          {
            version: `retired-${family}`,
            family,
            secret: deterministicTestKey(`archive:${family}`),
            retiredAt: '2026-10-01T12:00:00Z',
          },
        ]),
      },
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
        legacyReplayRuntimeReady: true,
        primaryIntake: { notReady: ['bank', 'custody', 'interest'] },
        alerts: { configured: true },
      },
    };
    const report = inspectPiggyvestWebhookCaptureReadiness(evidence);
    expect(report.details.replayOnlyKeys).toBe(1);
    expect(report.readyToAttest).toBe(false);
    expect(report.notReady).toContainEqual({
      gate: 'primary_intake',
      reason: `PRIMARY_INTAKE_NOT_READY:${family}`,
    });
  });
});
