import { describe, expect, it } from 'vitest';
import {
  getReconciliableStatusFilter,
  RECONCILABLE_VTU_TYPES,
} from './vtu-reconciliation-filter';

// Colocated contract for the extracted candidate filter (Codex R90
// P1 split): the cron-path tests in
// vtu-processing-reconciliation.test.ts assert the full filter
// string end to end; these pin the builder's own invariants
// (deterministic cutoff, arm presence, type coverage).
describe('getReconciliableStatusFilter', () => {
  const NOW = new Date('2026-05-07T21:14:00.000Z');
  const CUTOFF = '2026-05-07T20:59:00.000Z';

  it('derives the 15-minute lease cutoff from the invocation clock', () => {
    const filter = getReconciliableStatusFilter(NOW);
    expect(filter).toContain(
      `metadata->>customerReceiptEmailNotificationAttemptedAt.lt.${CUTOFF}`
    );
    expect(filter).toContain(
      `metadata->>customerTokenEmailNotificationAttemptedAt.lt.${CUTOFF}`
    );
    // Deterministic: same now, same filter.
    expect(getReconciliableStatusFilter(NOW)).toBe(filter);
  });

  it('covers every reconciliable type plus the settlement arms', () => {
    expect([...RECONCILABLE_VTU_TYPES]).toEqual([
      'airtime',
      'data',
      'electricity',
      'cable_tv',
      'betting',
    ]);
    const filter = getReconciliableStatusFilter(NOW);
    expect(filter).toContain('status.eq.processing');
    expect(filter).toContain(
      'metadata->>monnifyTransientVendError.not.is.null'
    );
    expect(filter).toContain('metadata->>preVendInterruptedAt.not.is.null');
    expect(filter).toContain('metadata->>refundIssued.is.null');
    expect(filter).toContain('metadata->>merchantWalletCredited.is.null');
    expect(filter).toContain('metadata->>customerWalletCredited.is.null');
    expect(filter).toContain('metadata->>loyaltyPointsAwarded.is.null');
  });

  it('carries the email-failure, stuck-claim, token-backfill, and retirement arms', () => {
    const filter = getReconciliableStatusFilter(NOW);
    // R86 recorded failures (receipt/legacy gated by the R92
    // token-unsent retirement gate; token ungated).
    const gate =
      'or(metadata->>customerTokenEmailNotificationSent.is.null,metadata->>customerTokenEmailNotificationSent.neq.true)';
    expect(filter).toContain(
      `and(metadata->>customerReceiptEmailNotificationSent.eq.false,${gate},or(metadata->>customerReceiptEmailNotificationSentDeliveryOutcome.is.null,metadata->>customerReceiptEmailNotificationSentDeliveryOutcome.neq.unknown))`
    );
    expect(filter).toContain(
      'and(metadata->>customerTokenEmailNotificationSent.eq.false,or(metadata->>customerTokenEmailNotificationSentDeliveryOutcome.is.null,metadata->>customerTokenEmailNotificationSentDeliveryOutcome.neq.unknown))'
    );
    // R89 stuck claims (receipt gated, token ungated).
    expect(filter).toContain(
      'metadata->>customerReceiptEmailNotificationAttempted.eq.true'
    );
    expect(filter).toContain(
      'metadata->>customerTokenEmailNotificationAttemptedAt.is.null'
    );
    // R90 token backfill with R93 legacy receipt markers.
    expect(filter).toContain(
      'or(metadata->>customerReceiptEmailNotificationSent.eq.true,metadata->>customerEmailNotificationSent.eq.true,metadata->>customerPendingTokenEmailNotificationSent.eq.true)'
    );
    // R82: no boolean `is.true/is.false` on text extraction.
    expect(filter).not.toMatch(/->>[a-zA-Z0-9_]+(\.not)?\.is\.(true|false)/);
  });

  it('excludes unknown-delivery rows from every email-failure arm', () => {
    // Codex R106 P2: a send ZeptoMail accepted but never
    // acknowledged may have landed — automatic retries must skip
    // it. Absent outcome (definite failure, legacy rows) stays
    // retryable via the null arm.
    const filter = getReconciliableStatusFilter(NOW);
    for (const sentKey of [
      'customerReceiptEmailNotificationSent',
      'customerTokenEmailNotificationSent',
      'customerEmailNotificationSent',
    ]) {
      expect(filter).toContain(
        `or(metadata->>${sentKey}DeliveryOutcome.is.null,metadata->>${sentKey}DeliveryOutcome.neq.unknown)`
      );
    }
  });
});
