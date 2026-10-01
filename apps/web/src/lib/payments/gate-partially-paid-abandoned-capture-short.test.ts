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
  insertError = null,
  stampData = true,
  stampError = null,
}: {
  confirmReview?: unknown;
  insertError?: unknown;
  stampData?: unknown;
  stampError?: unknown;
} = {}) {
  const insert = vi.fn().mockResolvedValue({ error: insertError });
  const confirmSingle = vi
    .fn()
    .mockResolvedValue({ data: confirmReview, error: null });
  const from = vi.fn(() => ({
    eq: vi.fn().mockReturnThis(),
    insert,
    is: vi.fn().mockReturnThis(),
    maybeSingle: confirmSingle,
    select: vi.fn().mockReturnThis(),
  }));
  const rpc = vi.fn().mockResolvedValue({ data: stampData, error: stampError });
  return { from, insert, rpc };
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

  it('holds without retiring when the conflict belongs to another order', async () => {
    const db = shortClient({
      confirmReview: null,
      insertError: { code: '23505' },
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
