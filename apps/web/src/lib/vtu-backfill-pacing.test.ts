import { describe, expect, it } from 'vitest';
import {
  isBackfillAttemptPaced,
  VOUCHER_PIN_BACKFILL_ATTEMPT_INTERVAL_MS,
  VOUCHER_PIN_BACKFILL_LAST_ATTEMPT_AT_KEY,
} from './vtu-backfill-pacing';

const NOW = Date.parse('2026-04-29T12:00:00.000Z');

function marker(msAgo: number) {
  return {
    [VOUCHER_PIN_BACKFILL_LAST_ATTEMPT_AT_KEY]: new Date(
      NOW - msAgo
    ).toISOString(),
  };
}

describe('vtu-backfill-pacing', () => {
  it('paces attempts inside the interval', () => {
    expect(isBackfillAttemptPaced(marker(0), NOW)).toBe(true);
    expect(
      isBackfillAttemptPaced(
        marker(VOUCHER_PIN_BACKFILL_ATTEMPT_INTERVAL_MS - 1),
        NOW
      )
    ).toBe(true);
  });

  it('allows attempts once the interval elapses', () => {
    expect(
      isBackfillAttemptPaced(
        marker(VOUCHER_PIN_BACKFILL_ATTEMPT_INTERVAL_MS),
        NOW
      )
    ).toBe(false);
    expect(
      isBackfillAttemptPaced(
        marker(VOUCHER_PIN_BACKFILL_ATTEMPT_INTERVAL_MS + 1),
        NOW
      )
    ).toBe(false);
  });

  it('never paces absent or unparseable markers', () => {
    expect(isBackfillAttemptPaced({}, NOW)).toBe(false);
    expect(
      isBackfillAttemptPaced(
        { [VOUCHER_PIN_BACKFILL_LAST_ATTEMPT_AT_KEY]: 'not-a-date' },
        NOW
      )
    ).toBe(false);
  });

  it('paces future markers (clock skew fails closed)', () => {
    expect(isBackfillAttemptPaced(marker(-60_000), NOW)).toBe(true);
  });
});
