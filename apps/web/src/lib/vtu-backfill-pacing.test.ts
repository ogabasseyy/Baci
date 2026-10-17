import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import {
  clearVoucherPinBackfillTimestamp,
  hasRecentBackfillSchedule,
  isBackfillAttemptPaced,
  MAX_VOUCHER_PIN_BACKFILL_ATTEMPTS,
  markVoucherPinBackfillScheduled,
  stableJsonStringify,
  TOKEN_BACKFILL_DEDUPE_WINDOW_MS,
  VOUCHER_PIN_BACKFILL_ATTEMPT_INTERVAL_MS,
  VOUCHER_PIN_BACKFILL_ATTEMPTS_KEY,
  VOUCHER_PIN_BACKFILL_LAST_ATTEMPT_AT_KEY,
  VOUCHER_PIN_BACKFILL_SCHEDULED_AT_KEY,
} from './vtu-backfill-pacing';

const NOW = Date.parse('2026-04-29T12:00:00.000Z');

type FilterCall = [string, string, unknown];

function createPacingSupabaseMock(rowCount: number, awaitable = false) {
  const calls: {
    filter?: FilterCall;
    is?: [string, unknown];
    update?: unknown;
  } = {};
  const query: Record<string, unknown> = {
    eq: vi.fn(() => query),
    filter: vi.fn((column: string, operator: string, value: unknown) => {
      calls.filter = [column, operator, value];
      // clearVoucherPinBackfillTimestamp awaits the filtered builder directly
      // (no .select), so resolve the terminal response here.
      return awaitable ? Promise.resolve({ error: null }) : query;
    }),
    is: vi.fn((column: string, value: unknown) => {
      calls.is = [column, value];
      return query;
    }),
    select: vi.fn(() =>
      Promise.resolve({
        data: Array.from({ length: rowCount }, () => ({ id: 'tx-1' })),
        error: null,
      })
    ),
  };
  const update = vi.fn((payload: unknown) => {
    calls.update = payload;
    return query;
  });
  const supabase = { from: vi.fn(() => ({ update })) } as unknown as {
    from: SupabaseClient['from'];
  };
  return { calls, supabase: supabase as unknown as SupabaseClient };
}

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

  it('detects recent schedule windows', () => {
    expect(
      hasRecentBackfillSchedule({
        [VOUCHER_PIN_BACKFILL_SCHEDULED_AT_KEY]: new Date(
          Date.now() - TOKEN_BACKFILL_DEDUPE_WINDOW_MS + 1000
        ).toISOString(),
      })
    ).toBe(true);
    expect(
      hasRecentBackfillSchedule({
        [VOUCHER_PIN_BACKFILL_SCHEDULED_AT_KEY]: new Date(
          Date.now() - TOKEN_BACKFILL_DEDUPE_WINDOW_MS - 1000
        ).toISOString(),
      })
    ).toBe(false);
  });

  it('reports a recent schedule when attempt cap is reached regardless of timestamp', () => {
    expect(
      hasRecentBackfillSchedule({
        [VOUCHER_PIN_BACKFILL_ATTEMPTS_KEY]: MAX_VOUCHER_PIN_BACKFILL_ATTEMPTS,
      })
    ).toBe(true);
    // One below the cap is still allowed
    expect(
      hasRecentBackfillSchedule({
        [VOUCHER_PIN_BACKFILL_ATTEMPTS_KEY]:
          MAX_VOUCHER_PIN_BACKFILL_ATTEMPTS - 1,
      })
    ).toBe(false);
  });

  it('serializes metadata with deterministic key order', () => {
    expect(stableJsonStringify({ a: 2, b: 1 })).toBe('{"a":2,"b":1}');
    expect(stableJsonStringify({ b: 1, a: { d: 4, c: 3 } })).toBe(
      '{"a":{"c":3,"d":4},"b":1}'
    );
    expect(() => stableJsonStringify({ key: undefined })).toThrow(TypeError);
  });

  it('marks the schedule with stable compare-and-set metadata', async () => {
    const { calls, supabase } = createPacingSupabaseMock(1);
    const next = await markVoucherPinBackfillScheduled({
      consumeAttempt: true,
      metadata: {},
      originalMetadata: { b: 1, a: 2 },
      supabase,
      transactionId: 'tx-1',
    });
    expect(next?.[VOUCHER_PIN_BACKFILL_ATTEMPTS_KEY]).toBe(1);
    expect(next?.[VOUCHER_PIN_BACKFILL_SCHEDULED_AT_KEY]).toEqual(
      expect.any(String)
    );
    expect(calls.filter).toEqual(['metadata', 'eq', '{"a":2,"b":1}']);
  });

  it('returns null when another writer claims the row first', async () => {
    const { calls, supabase } = createPacingSupabaseMock(0);
    await expect(
      markVoucherPinBackfillScheduled({
        consumeAttempt: false,
        metadata: {},
        originalMetadata: null,
        supabase,
        transactionId: 'tx-1',
      })
    ).resolves.toBeNull();
    expect(calls.is).toEqual(['metadata', null]);
  });

  it('clears the scheduled timestamp with stable compare-and-set', async () => {
    const { calls, supabase } = createPacingSupabaseMock(0, true);
    const current = {
      [VOUCHER_PIN_BACKFILL_SCHEDULED_AT_KEY]: 't',
      a: 2,
      z: 1,
    };
    await clearVoucherPinBackfillTimestamp({
      currentMetadata: current,
      supabase,
      transactionId: 'tx-1',
    });
    expect(calls.update).toEqual({ metadata: { a: 2, z: 1 } });
    expect(calls.filter?.[2]).toBe(stableJsonStringify(current));
  });
});
