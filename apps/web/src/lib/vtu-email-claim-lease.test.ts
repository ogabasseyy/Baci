import { describe, expect, it } from 'vitest';
import {
  getCustomerEmailClaimLeaseGeneration,
  isCustomerEmailClaimLeaseExpired,
} from './vtu-email-claim-lease';

describe('isCustomerEmailClaimLeaseExpired', () => {
  it('expires email claim leases after 15 minutes and treats unstamped claims as expired', async () => {
    // Codex R89 P2: the claim RPC stamps `<attemptedKey>At`; a crash
    // between claim and send/clear wedges Attempted=true forever
    // unless the pre-check honors the lease. Missing/unparseable
    // stamps are exactly the pre-lease stuck population → expired.
    const state = {
      attemptedKey: 'customerReceiptEmailNotificationAttempted',
      sentKey: 'customerReceiptEmailNotificationSent',
    };
    const nowMs = Date.parse('2026-05-07T21:14:00.000Z');
    expect(
      isCustomerEmailClaimLeaseExpired({ metadata: {}, nowMs, state })
    ).toBe(true);
    expect(
      isCustomerEmailClaimLeaseExpired({
        metadata: {
          customerReceiptEmailNotificationAttemptedAt: 'not-a-timestamp',
        },
        nowMs,
        state,
      })
    ).toBe(true);
    expect(
      isCustomerEmailClaimLeaseExpired({
        metadata: {
          customerReceiptEmailNotificationAttemptedAt:
            '2026-05-07T20:58:59.999Z',
        },
        nowMs,
        state,
      })
    ).toBe(true);
    // Boundary agrees with the RPC / reconciler strict `<`: exactly
    // at the cutoff the lease is still fresh.
    expect(
      isCustomerEmailClaimLeaseExpired({
        metadata: {
          customerReceiptEmailNotificationAttemptedAt:
            '2026-05-07T20:59:00.000Z',
        },
        nowMs,
        state,
      })
    ).toBe(false);
    expect(
      isCustomerEmailClaimLeaseExpired({
        metadata: {
          customerReceiptEmailNotificationAttemptedAt:
            '2026-05-07T20:59:00.001Z',
        },
        nowMs,
        state,
      })
    ).toBe(false);
  });
});

describe('getCustomerEmailClaimLeaseGeneration', () => {
  it('returns the stamped generation and null for missing/blank/non-string stamps', () => {
    // Codex R97 P2: the clear RPC fences on this generation; a missing
    // stamp means no owned lease, so the caller must not clear at all.
    const state = {
      attemptedKey: 'customerTokenEmailNotificationAttempted',
      sentKey: 'customerTokenEmailNotificationSent',
    };
    expect(
      getCustomerEmailClaimLeaseGeneration({
        metadata: {
          customerTokenEmailNotificationAttemptedAt: '2026-10-15T00:00:00.000Z',
        },
        state,
      })
    ).toBe('2026-10-15T00:00:00.000Z');
    expect(
      getCustomerEmailClaimLeaseGeneration({ metadata: {}, state })
    ).toBeNull();
    expect(
      getCustomerEmailClaimLeaseGeneration({
        metadata: { customerTokenEmailNotificationAttemptedAt: '   ' },
        state,
      })
    ).toBeNull();
    expect(
      getCustomerEmailClaimLeaseGeneration({
        metadata: { customerTokenEmailNotificationAttemptedAt: 123 },
        state,
      })
    ).toBeNull();
  });
});
