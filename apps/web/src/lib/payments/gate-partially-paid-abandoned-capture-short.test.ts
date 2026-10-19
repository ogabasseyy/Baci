import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { fileShortCaptureAndRetire } from './gate-partially-paid-abandoned-capture-short';

const attempt = {
  gateway_reference: 'BAC-SHORT',
  id: 'attempt-1',
  merchant_id: 'merchant-1',
  order_id: 'order-1',
};

const evidence = {
  captureMinor: 5000,
  outstandingMinor: 7000,
  providerData: { currency: 'NGN', id: 555, status: 'success' },
};

function harness() {
  return {
    hold: vi.fn().mockResolvedValue(undefined),
    summary: {
      completed: [] as string[],
      failed: false,
      reviewsFiled: [] as string[],
    },
  };
}

function shortClient({
  confirmReview = { txn_id: 'attempt-1' },
  ownReview = null,
  insertError = null,
  insertErrors = [],
  siblingReview = { id: 'review-9', metadata: {} },
  confirmCaptures = { 'attempt-1': { capture_amount_minor: 5000 } },
  updateRows = [{ id: 'review-9' }],
  updateError = null,
  stampData = true,
  stampError = null,
}: {
  confirmReview?: unknown;
  ownReview?: unknown;
  insertError?: unknown;
  insertErrors?: unknown[];
  siblingReview?: unknown;
  confirmCaptures?: unknown;
  updateRows?: unknown;
  updateError?: unknown;
  stampData?: unknown;
  stampError?: unknown;
} = {}) {
  const insert = vi.fn();
  for (const error of insertErrors) {
    insert.mockResolvedValueOnce({ error });
  }
  insert.mockResolvedValue({ error: insertError });
  // maybeSingle order: own review by reference, own review by
  // transaction, append confirmation. The sibling lookup uses
  // limit(1): multiple open reviews per order are permitted.
  const confirmSingle = vi
    .fn()
    .mockResolvedValueOnce({ data: confirmReview, error: null })
    .mockResolvedValueOnce({ data: ownReview, error: null })
    .mockResolvedValueOnce({
      data: { metadata: { short_captures: confirmCaptures } },
      error: null,
    });
  const siblingLimit = vi
    .fn()
    .mockResolvedValue({ data: [siblingReview], error: null });
  const updateSelect = vi
    .fn()
    .mockResolvedValue({ data: updateRows, error: updateError });
  const updateBuilder = {
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    select: updateSelect,
  };
  const update = vi.fn(() => updateBuilder);
  const from = vi.fn(() => ({
    eq: vi.fn().mockReturnThis(),
    insert,
    is: vi.fn().mockReturnThis(),
    limit: siblingLimit,
    maybeSingle: confirmSingle,
    select: vi.fn().mockReturnThis(),
    update,
  }));
  const rpc = vi.fn().mockResolvedValue({ data: stampData, error: stampError });
  return { from, insert, rpc, update };
}

describe('fileShortCaptureAndRetire', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('files the short-capture review and retires the attempt', async () => {
    const db = shortClient();
    const h = harness();

    const gate = await fileShortCaptureAndRetire(
      { ...h, attempt, supabase: db as never },
      evidence
    );

    expect(gate).toBe('done');
    expect(db.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'partial_capture_short_requires_review',
        metadata: expect.objectContaining({
          capture_amount_minor: 5000,
          currency: 'NGN',
          outstanding_amount_minor: 7000,
          provider_reference: '555',
          provider_status: 'success',
        }),
        reason: expect.stringContaining('5000 of 7000 kobo'),
        txn_id: 'attempt-1',
      })
    );
    expect(db.rpc).toHaveBeenCalledWith(
      'stamp_abandoned_sweep_resolution_v1',
      expect.objectContaining({
        p_expected_reference: 'BAC-SHORT',
        p_resolution: 'partial_capture_short_reviewed',
        p_transaction_id: 'attempt-1',
      })
    );
    expect(h.summary.reviewsFiled).toEqual(['attempt-1']);
    expect(h.summary.failed).toBe(false);
    expect(h.hold).not.toHaveBeenCalled();
  });

  it('defaults the review currency to NGN when the provider omits it', async () => {
    const db = shortClient();
    const h = harness();

    await fileShortCaptureAndRetire(
      { ...h, attempt, supabase: db as never },
      {
        ...evidence,
        providerData: {},
      }
    );

    expect(db.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          currency: 'NGN',
          provider_reference: '',
          provider_status: '',
        }),
      })
    );
  });

  it('treats a redelivered short capture as filed and still retires it', async () => {
    const db = shortClient({ insertError: { code: '23505' } });
    const h = harness();

    const gate = await fileShortCaptureAndRetire(
      { ...h, attempt, supabase: db as never },
      evidence
    );

    expect(gate).toBe('done');
    expect(db.rpc).toHaveBeenCalled();
    expect(h.summary.reviewsFiled).toEqual(['attempt-1']);
    expect(h.hold).not.toHaveBeenCalled();
  });

  it('refiles without the reference when another order owns it', async () => {
    const db = shortClient({
      confirmReview: null,
      insertErrors: [{ code: '23505' }, null],
    });
    const h = harness();

    const gate = await fileShortCaptureAndRetire(
      { ...h, attempt, supabase: db as never },
      evidence
    );

    // Holding here would rotate on the same global conflict every
    // sweep while this pending attempt blocks order cancellation;
    // the ref-less review reaches the operations queue instead.
    expect(gate).toBe('done');
    expect(db.insert).toHaveBeenCalledTimes(2);
    expect(db.insert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        paystack_ref: null,
        txn_id: 'attempt-1',
      })
    );
    expect(db.rpc).toHaveBeenCalled();
    expect(h.summary.reviewsFiled).toEqual(['attempt-1']);
    expect(h.summary.failed).toBe(false);
    expect(h.hold).not.toHaveBeenCalled();
  });

  it('accepts its own reference-less review filed by an earlier run', async () => {
    const db = shortClient({
      confirmReview: null,
      ownReview: { id: 'review-7' },
      insertErrors: [{ code: '23505' }, { code: '23505' }],
    });
    const h = harness();

    const gate = await fileShortCaptureAndRetire(
      { ...h, attempt, supabase: db as never },
      evidence
    );

    // The earlier run filed before failing to stamp: the review is
    // already in the operations queue, so retire instead of merging
    // into a sibling or holding an already-reviewed capture forever.
    expect(gate).toBe('done');
    expect(db.update).not.toHaveBeenCalled();
    expect(db.rpc).toHaveBeenCalled();
    expect(h.summary.reviewsFiled).toEqual(['attempt-1']);
    expect(h.summary.failed).toBe(false);
    expect(h.hold).not.toHaveBeenCalled();
  });

  it('appends to the sibling review when the order slot is taken', async () => {
    const db = shortClient({
      confirmReview: null,
      insertErrors: [{ code: '23505' }, { code: '23505' }],
    });
    const h = harness();

    const gate = await fileShortCaptureAndRetire(
      { ...h, attempt, supabase: db as never },
      evidence
    );

    expect(gate).toBe('done');
    expect(db.update).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          short_captures: expect.objectContaining({
            'attempt-1': expect.objectContaining({
              capture_amount_minor: 5000,
              outstanding_amount_minor: 7000,
            }),
          }),
        }),
      })
    );
    expect(db.rpc).toHaveBeenCalled();
    expect(h.summary.reviewsFiled).toEqual(['attempt-1']);
    expect(h.summary.failed).toBe(false);
    expect(h.hold).not.toHaveBeenCalled();
  });

  it('holds without retiring when the sibling append fails', async () => {
    const db = shortClient({
      confirmReview: null,
      insertErrors: [{ code: '23505' }, { code: '23505' }],
      updateError: { code: 'XX000' },
    });
    const h = harness();

    const gate = await fileShortCaptureAndRetire(
      { ...h, attempt, supabase: db as never },
      evidence
    );

    expect(gate).toBe('done');
    expect(db.rpc).not.toHaveBeenCalled();
    expect(h.summary.failed).toBe(true);
    expect(h.hold).toHaveBeenCalledWith('partial_short_review_failed');
    expect(h.summary.reviewsFiled).toEqual([]);
  });

  it('holds when the short-capture review cannot be filed', async () => {
    const db = shortClient({ insertError: { code: '50000' } });
    const h = harness();

    await fileShortCaptureAndRetire(
      { ...h, attempt, supabase: db as never },
      evidence
    );

    expect(db.rpc).not.toHaveBeenCalled();
    expect(h.hold).toHaveBeenCalledWith('partial_short_review_failed');
  });

  it('holds when the short-capture stamp misses', async () => {
    const db = shortClient({ stampData: false });
    const h = harness();

    await fileShortCaptureAndRetire(
      { ...h, attempt, supabase: db as never },
      evidence
    );

    expect(h.summary.failed).toBe(true);
    expect(h.hold).toHaveBeenCalledWith('partial_short_stamp_failed');
    expect(h.summary.reviewsFiled).toEqual([]);
  });
});
