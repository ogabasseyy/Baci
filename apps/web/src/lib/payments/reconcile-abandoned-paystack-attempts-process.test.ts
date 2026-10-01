import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fileInvalidAttemptReference: vi.fn(),
  fileUnresolvedAttemptReference: vi.fn(),
  resolveAbandonedAttemptMismatch: vi.fn(),
  resolveVerifiedAbandonedAttemptCapture: vi.fn(),
}));

vi.mock('./file-invalid-attempt-reference', () => ({
  fileInvalidAttemptReference: mocks.fileInvalidAttemptReference,
}));

vi.mock('./file-unresolved-attempt-reference', () => ({
  fileUnresolvedAttemptReference: mocks.fileUnresolvedAttemptReference,
}));

vi.mock('./resolve-abandoned-attempt-mismatch', () => ({
  resolveAbandonedAttemptMismatch: mocks.resolveAbandonedAttemptMismatch,
}));

vi.mock('./resolve-verified-abandoned-attempt-capture', () => ({
  resolveVerifiedAbandonedAttemptCapture:
    mocks.resolveVerifiedAbandonedAttemptCapture,
}));

import { processAbandonedPaystackAttempt } from './reconcile-abandoned-paystack-attempts-process';

const attempt = {
  amount: 100,
  currency: 'NGN',
  gateway_reference: 'BAC-OLD',
  id: 'attempt-1',
  merchant_id: 'merchant-1',
  metadata: {},
  order_id: 'order-1',
  paid_order: { payment_status: 'paid' },
  platform_fee: null,
  status: 'pending',
} as const;

function summary() {
  return {
    checked: 1,
    completed: [] as string[],
    failed: false,
    held: [] as Array<{ id: string; reason: string }>,
    retired: [] as string[],
    reviewsFiled: [] as string[],
  };
}

function processClient({
  completed = [{ id: 'paid-attempt' }],
  completedError = null,
  order = { id: 'order-1' },
  orderError = null,
  retirement = { data: [{ id: 'attempt-1' }], error: null },
  rotationError = null,
}: {
  completed?: unknown;
  completedError?: unknown;
  order?: unknown;
  orderError?: unknown;
  retirement?: unknown;
  rotationError?: unknown;
} = {}) {
  const orderLookup = {
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: order, error: orderError }),
  };
  const completedLookup = {
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    limit: vi
      .fn()
      .mockResolvedValue({ data: completed, error: completedError }),
  };
  const updateBuilder: Record<string, unknown> = {};
  updateBuilder.eq = vi.fn().mockReturnValue(updateBuilder);
  updateBuilder.select = vi.fn().mockResolvedValue(retirement);
  // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are thenable.
  updateBuilder.then = (resolve: (value: unknown) => void) =>
    resolve({ error: rotationError });
  const update = vi.fn().mockReturnValue(updateBuilder);
  const from = vi.fn((table: string) => ({
    select: vi.fn(() => (table === 'orders' ? orderLookup : completedLookup)),
    update,
  }));
  return { client: { from }, completedLookup, orderLookup, update };
}

function verified(status: string, overrides = {}) {
  return {
    success: true as const,
    data: {
      amount: 10000,
      currency: 'NGN',
      reference: 'BAC-OLD',
      status,
      ...overrides,
    },
  };
}

describe('processAbandonedPaystackAttempt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fileInvalidAttemptReference.mockResolvedValue(true);
    mocks.fileUnresolvedAttemptReference.mockResolvedValue(true);
    mocks.resolveAbandonedAttemptMismatch.mockResolvedValue(false);
    mocks.resolveVerifiedAbandonedAttemptCapture.mockResolvedValue(undefined);
  });

  it('retires a provider-confirmed abandoned attempt', async () => {
    const db = processClient();
    const s = summary();
    const verify = vi.fn().mockResolvedValue(verified('abandoned'));

    await processAbandonedPaystackAttempt(
      db.client as never,
      attempt as never,
      {
        scheduleAfter: vi.fn(),
        summary: s,
        verify: verify as never,
      }
    );

    expect(verify).toHaveBeenCalledWith('BAC-OLD', expect.any(AbortSignal));
    expect(db.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' })
    );
    expect(s.retired).toEqual(['attempt-1']);
    expect(s.held).toEqual([]);
  });

  it('holds when the order is not paid without verifying', async () => {
    const db = processClient({ order: null });
    const s = summary();
    const verify = vi.fn();

    await processAbandonedPaystackAttempt(
      db.client as never,
      attempt as never,
      {
        scheduleAfter: vi.fn(),
        summary: s,
        verify: verify as never,
      }
    );

    expect(verify).not.toHaveBeenCalled();
    expect(s.held).toEqual([
      { id: 'attempt-1', reason: 'order_not_paid_or_unavailable' },
    ]);
    expect(db.orderLookup.in).toHaveBeenCalledWith('payment_status', [
      'paid',
      'partially_paid',
    ]);
  });

  it('holds when no completed payment supersedes the attempt', async () => {
    const db = processClient({ completed: [] });
    const s = summary();
    const verify = vi.fn();

    await processAbandonedPaystackAttempt(
      db.client as never,
      attempt as never,
      {
        scheduleAfter: vi.fn(),
        summary: s,
        verify: verify as never,
      }
    );

    expect(verify).not.toHaveBeenCalled();
    expect(s.held).toEqual([
      { id: 'attempt-1', reason: 'no_completed_payment_or_unavailable' },
    ]);
  });

  it('holds as unavailable when verification throws', async () => {
    const db = processClient();
    const s = summary();
    const verify = vi.fn().mockRejectedValue(new Error('timeout'));

    await processAbandonedPaystackAttempt(
      db.client as never,
      attempt as never,
      {
        scheduleAfter: vi.fn(),
        summary: s,
        verify: verify as never,
      }
    );

    expect(s.failed).toBe(true);
    expect(s.held).toEqual([
      { id: 'attempt-1', reason: 'verification_unavailable' },
    ]);
  });

  it('files a durable review for a deterministically rejected reference', async () => {
    const db = processClient();
    const s = summary();
    const verify = vi
      .fn()
      .mockResolvedValue({ success: false, code: 'HTTP_400' });

    await processAbandonedPaystackAttempt(
      db.client as never,
      attempt as never,
      {
        scheduleAfter: vi.fn(),
        summary: s,
        verify: verify as never,
      }
    );

    expect(mocks.fileInvalidAttemptReference).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'HTTP_400' })
    );
    expect(s.reviewsFiled).toEqual(['attempt-1']);
    expect(s.held).toEqual([]);
  });

  it('files unresolved evidence and keeps rotating a non-DVA 404', async () => {
    const db = processClient();
    const s = summary();
    const verify = vi
      .fn()
      .mockResolvedValue({ success: false, code: 'HTTP_404' });

    await processAbandonedPaystackAttempt(
      db.client as never,
      attempt as never,
      {
        scheduleAfter: vi.fn(),
        summary: s,
        verify: verify as never,
      }
    );

    expect(mocks.fileUnresolvedAttemptReference).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'HTTP_404' })
    );
    expect(s.reviewsFiled).toEqual(['attempt-1']);
    expect(s.held).toEqual([
      { id: 'attempt-1', reason: 'verification_unavailable' },
    ]);
  });

  it('delegates a verified capture with matching evidence', async () => {
    const db = processClient();
    const s = summary();
    const verify = vi.fn().mockResolvedValue(verified('success'));
    const finalizePayment = vi.fn();
    const scheduleAfter = vi.fn();

    await processAbandonedPaystackAttempt(
      db.client as never,
      attempt as never,
      {
        finalizePayment: finalizePayment as never,
        scheduleAfter,
        summary: s,
        verify: verify as never,
      }
    );

    expect(mocks.resolveVerifiedAbandonedAttemptCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        mismatchKind: null,
        paidOrderStatus: 'paid',
      })
    );
    expect(s.retired).toEqual([]);
  });

  it('routes amount evidence mismatches to the mismatch resolver', async () => {
    const db = processClient();
    const s = summary();
    const verify = vi
      .fn()
      .mockResolvedValue(verified('failed', { amount: 5000 }));

    await processAbandonedPaystackAttempt(
      db.client as never,
      attempt as never,
      {
        scheduleAfter: vi.fn(),
        summary: s,
        verify: verify as never,
      }
    );

    expect(mocks.resolveAbandonedAttemptMismatch).toHaveBeenCalledWith(
      expect.objectContaining({ mismatchKind: 'payment_evidence_mismatch' })
    );
    expect(mocks.resolveVerifiedAbandonedAttemptCapture).not.toHaveBeenCalled();
  });
});
