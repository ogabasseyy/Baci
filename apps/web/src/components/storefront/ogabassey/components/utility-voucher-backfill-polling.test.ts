import { describe, expect, it } from 'vitest';
import {
  backfillPollDelayMs,
  UTILITY_VOUCHER_BACKFILL_PATIENT_INTERVAL_MS,
  UTILITY_VOUCHER_BACKFILL_POLL_INTERVAL_MS,
  UTILITY_VOUCHER_BACKFILL_SLOW_INTERVAL_MS,
} from './utility-voucher-backfill-polling';

describe('backfillPollDelayMs', () => {
  it('polls fast for the first 10 attempts', () => {
    expect(backfillPollDelayMs(1)).toBe(UTILITY_VOUCHER_BACKFILL_POLL_INTERVAL_MS);
    expect(backfillPollDelayMs(10)).toBe(
      UTILITY_VOUCHER_BACKFILL_POLL_INTERVAL_MS
    );
  });

  it('slows to 10s through attempt 43 (one reconciler pass)', () => {
    expect(backfillPollDelayMs(11)).toBe(UTILITY_VOUCHER_BACKFILL_SLOW_INTERVAL_MS);
    expect(backfillPollDelayMs(43)).toBe(UTILITY_VOUCHER_BACKFILL_SLOW_INTERVAL_MS);
  });

  it('goes patient (60s) beyond the slow lane', () => {
    expect(backfillPollDelayMs(44)).toBe(
      UTILITY_VOUCHER_BACKFILL_PATIENT_INTERVAL_MS
    );
    expect(backfillPollDelayMs(1000)).toBe(
      UTILITY_VOUCHER_BACKFILL_PATIENT_INTERVAL_MS
    );
  });
});
