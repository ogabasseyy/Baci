import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { createAdminClient } from '@/lib/supabase/admin';
import {
  VOUCHER_PIN_BACKFILL_ATTEMPT_INTERVAL_MS,
  VOUCHER_PIN_BACKFILL_ATTEMPTS_KEY,
  VOUCHER_PIN_BACKFILL_LAST_ATTEMPT_AT_KEY,
  VOUCHER_PIN_BACKFILL_SCHEDULED_AT_KEY,
} from '@/lib/vtu-backfill-pacing';
import {
  extractMetadataField,
  isReferenceLessProcessingTransaction,
  isString,
  normalizeMetadata,
  scheduleVoucherPinBackfill,
  shouldBackfillForStatus,
  shouldBackfillForType,
} from '@/lib/vtu-voucher-backfill';

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  backfillVtuVoucherPin: vi.fn(),
  fulfillPendingVtuTransaction: vi.fn(),
}));

vi.mock('next/server', () => ({
  after: mocks.after,
}));

vi.mock('@/lib/vtu-fulfillment', () => ({
  backfillVtuVoucherPin: mocks.backfillVtuVoucherPin,
  fulfillPendingVtuTransaction: mocks.fulfillPendingVtuTransaction,
}));

interface UpdateQueryMock {
  eq: ReturnType<
    typeof vi.fn<(_column: string, _value: unknown) => UpdateQueryMock>
  >;
  filter: ReturnType<
    typeof vi.fn<
      (_column: string, _operator: string, _value: unknown) => UpdateQueryMock
    >
  >;
  is: ReturnType<
    typeof vi.fn<(_column: string, _value: unknown) => UpdateQueryMock>
  >;
  select: ReturnType<
    typeof vi.fn<() => Promise<{ data: Array<{ id: string }>; error: unknown }>>
  >;
}

function createUpdateQueryMock({
  data = [{ id: 'tx-1' }],
  error = null,
}: {
  data?: Array<{ id: string }>;
  error?: unknown;
} = {}) {
  let query: UpdateQueryMock;
  query = {
    eq: vi.fn((_column: string, _value: unknown) => query),
    filter: vi.fn(
      (_column: string, _operator: string, _value: unknown) => query
    ),
    is: vi.fn((_column: string, _value: unknown) => query),
    select: vi.fn(() => Promise.resolve({ data, error })),
  };

  return query;
}

function createSupabaseMock(updateQuery: UpdateQueryMock) {
  const update = vi.fn(() => updateQuery);
  const from = vi.fn(() => ({
    update,
  }));

  return {
    from,
    supabase: { from } as unknown as ReturnType<typeof createAdminClient>,
    update,
  };
}

function createTransaction(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tx-1',
    request_reference: 'REQ-123',
    status: 'successful',
    transaction_id: 'RESP-123',
    type: 'electricity',
    ...overrides,
  };
}

describe('vtu-voucher-backfill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-29T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('normalizes metadata and validates typed metadata fields', () => {
    expect(normalizeMetadata(null)).toEqual({});
    expect(normalizeMetadata(['not', 'metadata'])).toEqual({});
    expect(normalizeMetadata({ alpha: 'first' })).toEqual({ alpha: 'first' });

    expect(
      extractMetadataField({ reference: 'REQ-123' }, 'reference', isString)
    ).toBe('REQ-123');
    expect(
      extractMetadataField({ reference: 123 }, 'reference', isString)
    ).toBe(null);
  });

  it('detects token-backed types and eligible statuses', () => {
    expect(shouldBackfillForType('electricity')).toBe(true);
    expect(shouldBackfillForType('cable_tv')).toBe(true);
    expect(shouldBackfillForType('airtime')).toBe(false);
    expect(shouldBackfillForStatus('successful')).toBe(true);
    expect(shouldBackfillForStatus('processing')).toBe(true);
    expect(shouldBackfillForStatus('failed')).toBe(false);
  });

  it('flags only processing rows with neither provider reference nor response', () => {
    expect(
      isReferenceLessProcessingTransaction({
        error_message: null,
        status: 'processing',
        transaction_id: null,
      })
    ).toBe(true);
    expect(
      isReferenceLessProcessingTransaction({
        error_message: null,
        status: 'processing',
        transaction_id: 'kuda-ref-1',
      })
    ).toBe(false);
    expect(
      isReferenceLessProcessingTransaction({
        error_message: 'Accepted',
        status: 'processing',
        transaction_id: null,
      })
    ).toBe(false);
    expect(
      isReferenceLessProcessingTransaction({
        error_message: null,
        status: 'successful',
        transaction_id: null,
      })
    ).toBe(false);
  });

  it('skips scheduling while a successful attempt is still paced', async () => {
    const updateQuery = createUpdateQueryMock();
    const { supabase, update } = createSupabaseMock(updateQuery);

    const scheduled = await scheduleVoucherPinBackfill({
      metadata: {
        [VOUCHER_PIN_BACKFILL_ATTEMPTS_KEY]: 1,
        [VOUCHER_PIN_BACKFILL_LAST_ATTEMPT_AT_KEY]: new Date(
          Date.now() - VOUCHER_PIN_BACKFILL_ATTEMPT_INTERVAL_MS + 1000
        ).toISOString(),
      },
      originalMetadata: {},
      supabase,
      transaction: createTransaction(),
      voucherPin: null,
    });

    expect(scheduled).toBe(false);
    expect(update).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it('schedules again once the pacing interval elapses', async () => {
    const updateQuery = createUpdateQueryMock();
    const { supabase, update } = createSupabaseMock(updateQuery);

    const scheduled = await scheduleVoucherPinBackfill({
      metadata: {
        [VOUCHER_PIN_BACKFILL_ATTEMPTS_KEY]: 1,
        [VOUCHER_PIN_BACKFILL_LAST_ATTEMPT_AT_KEY]: new Date(
          Date.now() - VOUCHER_PIN_BACKFILL_ATTEMPT_INTERVAL_MS - 1000
        ).toISOString(),
      },
      originalMetadata: {},
      supabase,
      transaction: createTransaction(),
      voucherPin: null,
    });

    expect(scheduled).toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
    expect(mocks.after).toHaveBeenCalledTimes(1);
  });

  it('marks metadata (with attempt counter) and defers voucher-pin backfill for eligible transactions', async () => {
    const updateQuery = createUpdateQueryMock();
    const { supabase, update } = createSupabaseMock(updateQuery);
    mocks.backfillVtuVoucherPin.mockResolvedValue({
      voucherPin: '1234-5678',
      units: undefined,
    });

    const scheduled = await scheduleVoucherPinBackfill({
      metadata: { alpha: 'first' },
      originalMetadata: { zeta: 'last', alpha: 'first' },
      supabase,
      transaction: createTransaction(),
      voucherPin: null,
    });

    expect(scheduled).toBe(true);
    expect(update).toHaveBeenCalledWith({
      metadata: {
        alpha: 'first',
        [VOUCHER_PIN_BACKFILL_SCHEDULED_AT_KEY]: '2026-04-29T12:00:00.000Z',
        [VOUCHER_PIN_BACKFILL_ATTEMPTS_KEY]: 1,
        [VOUCHER_PIN_BACKFILL_LAST_ATTEMPT_AT_KEY]: '2026-04-29T12:00:00.000Z',
      },
    });
    expect(updateQuery.eq).toHaveBeenCalledWith('id', 'tx-1');
    expect(updateQuery.filter).toHaveBeenCalledWith(
      'metadata',
      'eq',
      expect.any(String)
    );

    const serializedMetadata = String(
      updateQuery.filter.mock.calls[0]?.[2]
    ).replace(/::jsonb$/, '');
    expect(JSON.parse(serializedMetadata)).toEqual({
      alpha: 'first',
      zeta: 'last',
    });

    expect(mocks.after).toHaveBeenCalledTimes(1);
    const deferredBackfill = mocks.after.mock.calls[0]?.[0] as
      | (() => Promise<void>)
      | undefined;
    expect(deferredBackfill).toBeDefined();

    await deferredBackfill?.();

    expect(mocks.backfillVtuVoucherPin).toHaveBeenCalledWith({
      billRequestRef: 'REQ-123',
      billResponseReference: 'RESP-123',
      metadata: {
        alpha: 'first',
        [VOUCHER_PIN_BACKFILL_SCHEDULED_AT_KEY]: '2026-04-29T12:00:00.000Z',
        [VOUCHER_PIN_BACKFILL_ATTEMPTS_KEY]: 1,
        [VOUCHER_PIN_BACKFILL_LAST_ATTEMPT_AT_KEY]: '2026-04-29T12:00:00.000Z',
      },
      supabase,
      transactionId: 'tx-1',
    });

    // Pin was found — no timestamp clear needed
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('runs the provider poll inline with deferPoll: false and registers no after() (Muse R151 M1)', async () => {
    // History GET already runs inside its own after(): the mark and
    // the poll both execute here so the schedule stays a single
    // layer — nothing nests.
    const updateQuery = createUpdateQueryMock();
    const { supabase, update } = createSupabaseMock(updateQuery);
    mocks.backfillVtuVoucherPin.mockResolvedValue({
      voucherPin: '1234-5678',
      units: undefined,
    });

    const scheduled = await scheduleVoucherPinBackfill({
      deferPoll: false,
      metadata: { alpha: 'first' },
      originalMetadata: { zeta: 'last', alpha: 'first' },
      supabase,
      transaction: createTransaction(),
      voucherPin: null,
    });

    expect(scheduled).toBe(true);
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.backfillVtuVoucherPin).toHaveBeenCalledWith({
      billRequestRef: 'REQ-123',
      billResponseReference: 'RESP-123',
      metadata: {
        alpha: 'first',
        [VOUCHER_PIN_BACKFILL_SCHEDULED_AT_KEY]: '2026-04-29T12:00:00.000Z',
        [VOUCHER_PIN_BACKFILL_ATTEMPTS_KEY]: 1,
        [VOUCHER_PIN_BACKFILL_LAST_ATTEMPT_AT_KEY]: '2026-04-29T12:00:00.000Z',
      },
      supabase,
      transactionId: 'tx-1',
    });

    // Pin was found — mark only, no timestamp clear
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('clears the scheduled timestamp but keeps pacing state so retries spread across the window', async () => {
    const updateQuery = createUpdateQueryMock();
    const { supabase, update } = createSupabaseMock(updateQuery);
    mocks.backfillVtuVoucherPin.mockResolvedValue({
      voucherPin: undefined,
      units: undefined,
    });

    await scheduleVoucherPinBackfill({
      metadata: { alpha: 'first' },
      originalMetadata: { alpha: 'first' },
      supabase,
      transaction: createTransaction(),
      voucherPin: null,
    });

    const deferredBackfill = mocks.after.mock.calls[0]?.[0] as
      | (() => Promise<void>)
      | undefined;
    await deferredBackfill?.();

    // update called twice: once to mark scheduled, once to clear the timestamp
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenLastCalledWith({
      metadata: expect.not.objectContaining({
        [VOUCHER_PIN_BACKFILL_SCHEDULED_AT_KEY]: expect.anything(),
      }),
    });
    expect(update).toHaveBeenLastCalledWith({
      metadata: expect.objectContaining({
        [VOUCHER_PIN_BACKFILL_ATTEMPTS_KEY]: 1,
      }),
    });
    // The pacing marker survives the clear: an immediate next poll
    // must NOT schedule (that would burn the 10-lookup budget in
    // ~30s of a ~6min window).
    expect(update).toHaveBeenLastCalledWith({
      metadata: expect.objectContaining({
        [VOUCHER_PIN_BACKFILL_LAST_ATTEMPT_AT_KEY]: '2026-04-29T12:00:00.000Z',
      }),
    });

    // OCC: the clear must compare against the scheduled metadata so concurrent
    // writes (e.g. webhooks) are not clobbered.
    expect(updateQuery.filter).toHaveBeenCalledTimes(2);
    const clearFilterArg = String(
      updateQuery.filter.mock.lastCall?.[2]
    ).replace(/::jsonb$/, '');
    expect(JSON.parse(clearFilterArg)).toHaveProperty(
      VOUCHER_PIN_BACKFILL_SCHEDULED_AT_KEY
    );
  });

  it('defers processing transactions to one fulfillment reconciliation without consuming a no-pin attempt', async () => {
    const updateQuery = createUpdateQueryMock();
    const { supabase, update } = createSupabaseMock(updateQuery);
    mocks.fulfillPendingVtuTransaction.mockResolvedValue({
      amount: 1000,
      reference: 'REQ-123',
      status: 'processing',
    });

    const scheduled = await scheduleVoucherPinBackfill({
      metadata: { alpha: 'first' },
      originalMetadata: { alpha: 'first' },
      supabase,
      transaction: createTransaction({ status: 'processing' }),
      voucherPin: null,
    });

    expect(scheduled).toBe(true);

    const deferredBackfill = mocks.after.mock.calls[0]?.[0] as
      | (() => Promise<void>)
      | undefined;
    expect(deferredBackfill).toBeDefined();
    await deferredBackfill?.();

    expect(mocks.fulfillPendingVtuTransaction).toHaveBeenCalledWith({
      supabase,
      transactionId: 'tx-1',
    });
    expect(mocks.backfillVtuVoucherPin).not.toHaveBeenCalled();
    expect(update).toHaveBeenNthCalledWith(1, {
      metadata: expect.objectContaining({
        [VOUCHER_PIN_BACKFILL_SCHEDULED_AT_KEY]: '2026-04-29T12:00:00.000Z',
      }),
    });
    expect(update).toHaveBeenNthCalledWith(1, {
      metadata: expect.not.objectContaining({
        [VOUCHER_PIN_BACKFILL_ATTEMPTS_KEY]: expect.anything(),
      }),
    });
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenLastCalledWith({
      metadata: expect.not.objectContaining({
        [VOUCHER_PIN_BACKFILL_SCHEDULED_AT_KEY]: expect.anything(),
      }),
    });
    expect(update).toHaveBeenLastCalledWith({
      metadata: expect.objectContaining({
        alpha: 'first',
      }),
    });
    expect(update).toHaveBeenLastCalledWith({
      metadata: expect.not.objectContaining({
        [VOUCHER_PIN_BACKFILL_ATTEMPTS_KEY]: expect.anything(),
      }),
    });
    expect(updateQuery.filter).toHaveBeenCalledTimes(2);
    const clearFilterArg = String(
      updateQuery.filter.mock.lastCall?.[2]
    ).replace(/::jsonb$/, '');
    expect(JSON.parse(clearFilterArg)).toHaveProperty(
      VOUCHER_PIN_BACKFILL_SCHEDULED_AT_KEY
    );
  });

  it('skips reference-less processing rows: no pin can resolve and scheduling would postpone recovery', async () => {
    // The reconciliation claim declines without a provider reference
    // or response, so fulfill can never resolve a pin here — and
    // every schedule/clear cycle bumps updated_at, postponing the
    // 5-minute pre-vend staleness gate indefinitely while history
    // polling continues (Codex R42 rm5ao).
    const updateQuery = createUpdateQueryMock();
    const { supabase, update } = createSupabaseMock(updateQuery);

    const scheduled = await scheduleVoucherPinBackfill({
      metadata: { alpha: 'first' },
      originalMetadata: { alpha: 'first' },
      supabase,
      transaction: createTransaction({
        status: 'processing',
        transaction_id: null,
      }),
      voucherPin: null,
    });

    expect(scheduled).toBe(false);
    expect(update).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.fulfillPendingVtuTransaction).not.toHaveBeenCalled();
  });

  it('still schedules processing rows carrying a provider response message', async () => {
    // A provider response lets the reconciliation claim proceed, so
    // scheduling stays useful (may resolve a pin via fulfill).
    const updateQuery = createUpdateQueryMock();
    const { supabase, update } = createSupabaseMock(updateQuery);
    mocks.fulfillPendingVtuTransaction.mockResolvedValue({
      amount: 1000,
      reference: 'REQ-123',
      status: 'processing',
    });

    const scheduled = await scheduleVoucherPinBackfill({
      metadata: { alpha: 'first' },
      originalMetadata: { alpha: 'first' },
      supabase,
      transaction: createTransaction({
        error_message: 'ACCEPTED',
        status: 'processing',
        transaction_id: null,
      }),
      voucherPin: null,
    });

    expect(scheduled).toBe(true);
    expect(update).toHaveBeenCalled();
  });

  it('uses a null metadata comparison when the original metadata is absent', async () => {
    const updateQuery = createUpdateQueryMock();
    const { supabase } = createSupabaseMock(updateQuery);

    await scheduleVoucherPinBackfill({
      metadata: {},
      originalMetadata: null,
      supabase,
      transaction: createTransaction(),
      voucherPin: null,
    });

    expect(updateQuery.is).toHaveBeenCalledWith('metadata', null);
    expect(updateQuery.filter).not.toHaveBeenCalled();
  });

  it('throws instead of treating undefined original metadata as null', async () => {
    const updateQuery = createUpdateQueryMock();
    const { supabase } = createSupabaseMock(updateQuery);

    await expect(
      scheduleVoucherPinBackfill({
        metadata: {},
        originalMetadata: undefined,
        supabase,
        transaction: createTransaction(),
        voucherPin: null,
      })
    ).rejects.toThrow(
      'Cannot stable JSON stringify metadata containing undefined'
    );

    expect(updateQuery.is).not.toHaveBeenCalled();
    expect(updateQuery.filter).not.toHaveBeenCalled();
    expect(updateQuery.select).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it('skips ineligible transactions without scheduling deferred work', async () => {
    const updateQuery = createUpdateQueryMock();
    const { supabase, update } = createSupabaseMock(updateQuery);

    await expect(
      scheduleVoucherPinBackfill({
        metadata: {},
        originalMetadata: {},
        supabase,
        transaction: createTransaction({ type: 'airtime' }),
        voucherPin: null,
      })
    ).resolves.toBe(false);

    await expect(
      scheduleVoucherPinBackfill({
        metadata: {},
        originalMetadata: {},
        supabase,
        transaction: createTransaction(),
        voucherPin: '1234-5678',
      })
    ).resolves.toBe(false);

    await expect(
      scheduleVoucherPinBackfill({
        metadata: {},
        originalMetadata: {},
        supabase,
        transaction: createTransaction({ status: 'failed' }),
        voucherPin: null,
      })
    ).resolves.toBe(false);

    expect(update).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it('does not schedule backfill for transactions with invalid ids', async () => {
    const updateQuery = createUpdateQueryMock();
    const { supabase, update } = createSupabaseMock(updateQuery);
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    try {
      await expect(
        scheduleVoucherPinBackfill({
          metadata: {},
          originalMetadata: {},
          supabase,
          transaction: createTransaction({ id: { invalid: true } }),
          voucherPin: null,
        })
      ).resolves.toBe(false);

      expect(update).not.toHaveBeenCalled();
      expect(mocks.after).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Cannot schedule VTU voucher-pin backfill without an id:',
        expect.any(Object)
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('does not enqueue backfill when the metadata claim updates no rows', async () => {
    const updateQuery = createUpdateQueryMock({ data: [] });
    const { supabase } = createSupabaseMock(updateQuery);

    await expect(
      scheduleVoucherPinBackfill({
        metadata: {},
        originalMetadata: {},
        supabase,
        transaction: createTransaction(),
        voucherPin: null,
      })
    ).resolves.toBe(false);

    expect(mocks.after).not.toHaveBeenCalled();
  });
});
