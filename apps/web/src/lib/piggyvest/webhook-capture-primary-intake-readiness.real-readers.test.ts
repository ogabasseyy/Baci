import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { collectPrimaryIntakeEvidence } from './webhook-capture-primary-intake-readiness';

/**
 * The same evidence through the real intake runtime readers: a host that
 * holds the signing keys but has not enabled or configured the intakes
 * must not read as able to finish a replayed delivery.
 */
const NOW = new Date('2026-10-30T12:00:00.000Z');

describe('collectPrimaryIntakeEvidence against the real runtime readers', () => {
  it('reports every family not ready on a host with no intake configuration', () => {
    expect(collectPrimaryIntakeEvidence({ NODE_ENV: 'test' }, NOW)).toEqual({
      notReady: ['bank', 'custody', 'interest'],
    });
  });

  it('does not take an enable flag for a working intake', () => {
    // Flags without the credentials, scope and drain attestation the
    // intakes also require: the replay answers 503 for each of these.
    const flagsOnly: NodeJS.ProcessEnv = {
      NODE_ENV: 'test',
      PIGGYVEST_PRIMARY_BANK_INBOX_ENABLED: 'true',
      PIGGYVEST_PRIMARY_INFLOWS_ENABLED: 'true',
      PIGGYVEST_PRIMARY_PAID_INTEREST_INBOX_ENABLED: 'true',
      PIGGYVEST_PRIMARY_PAID_INTEREST_ENABLED: 'true',
      PIGGYVEST_PRIMARY_CARD_SIGNED_INBOX_ENABLED: 'true',
      PIGGYVEST_PRIMARY_CARD_CUSTODY_ENABLED: 'true',
    };
    expect(collectPrimaryIntakeEvidence(flagsOnly, NOW)).toEqual({
      notReady: ['bank', 'custody', 'interest'],
      legacyBankInflowUnavailable: true,
    });
  });
});
