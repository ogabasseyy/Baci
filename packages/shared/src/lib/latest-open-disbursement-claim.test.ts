import { describe, expect, it } from 'vitest';
import { findLatestOpenDisbursementClaim } from './latest-open-disbursement-claim';

const event = (
  id: number,
  type: string,
  claimId: string,
  createdAt: string
) => ({ id, type, createdAt, details: { claimId } });

describe('findLatestOpenDisbursementClaim', () => {
  it('selects the latest open claim by timestamp when events arrive out of order', () => {
    const older = event(
      12,
      'offline_disbursement_claimed',
      'claim-older',
      '2026-01-01T00:00:00Z'
    );
    const newer = event(
      13,
      'offline_disbursement_claimed',
      'claim-newer',
      '2026-01-02T00:00:00Z'
    );

    expect(findLatestOpenDisbursementClaim([newer, older])).toBe(newer);
  });

  it('skips verified claims and uses the event ID to break timestamp ties', () => {
    const verified = event(
      1,
      'offline_disbursement_claimed',
      'claim-verified',
      '2026-01-02T00:00:00Z'
    );
    const openOlder = event(
      2,
      'offline_disbursement_claimed',
      'claim-open-old',
      '2026-01-02T00:00:00Z'
    );
    const openNewer = event(
      3,
      'offline_disbursement_claimed',
      'claim-open-new',
      '2026-01-02T00:00:00Z'
    );
    const receipt = event(
      4,
      'offline_disbursement_verified',
      'claim-verified',
      '2026-01-03T00:00:00Z'
    );

    expect(
      findLatestOpenDisbursementClaim([verified, openOlder, openNewer, receipt])
    ).toBe(openNewer);
  });

  it('returns null when all claims are verified or absent', () => {
    const claim = event(
      1,
      'offline_disbursement_claimed',
      'claim-verified',
      '2026-01-01T00:00:00Z'
    );
    const receipt = event(
      2,
      'offline_disbursement_verified',
      'claim-verified',
      '2026-01-02T00:00:00Z'
    );

    expect(findLatestOpenDisbursementClaim([claim, receipt])).toBeNull();
    expect(findLatestOpenDisbursementClaim([])).toBeNull();
  });
});
