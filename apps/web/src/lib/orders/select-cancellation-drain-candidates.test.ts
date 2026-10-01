import { afterEach, describe, expect, it, vi } from 'vitest';
import { selectCancellationDrainCandidates } from './select-cancellation-drain-candidates';

function row(overrides: {
  attempts?: number;
  claimed_at?: string;
  order_id?: string;
  step?: 'customer_email' | 'refund';
}) {
  return {
    attempts: 1,
    claimed_at: '2026-07-22T00:00:00Z',
    order_id: 'order-1',
    step: 'refund' as const,
    ...overrides,
  };
}

describe('selectCancellationDrainCandidates', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('merges failed and deferred queues oldest-first', () => {
    const failed = row({ claimed_at: '2026-07-22T00:00:00Z', order_id: 'new' });
    const deferred = row({
      claimed_at: '2026-07-21T00:00:00Z',
      order_id: 'old',
    });

    const candidates = selectCancellationDrainCandidates({
      deferredRows: [deferred],
      failedRows: [failed],
      limit: 1,
      maxAttempts: 5,
    });

    expect([...candidates.keys()]).toEqual(['old:refund']);
  });

  it('returns no candidates when the drain limit is zero', () => {
    const candidates = selectCancellationDrainCandidates({
      deferredRows: [row({ order_id: 'deferred' })],
      failedRows: [row({ order_id: 'failed' })],
      limit: 0,
      maxAttempts: 5,
    });

    expect(candidates.size).toBe(0);
  });

  it('marks exhausted rows as last attempts', () => {
    const candidates = selectCancellationDrainCandidates({
      deferredRows: [
        row({ attempts: 5, order_id: 'exhausted' }),
        row({ attempts: 1, order_id: 'fresh' }),
      ],
      failedRows: [],
      limit: 10,
      maxAttempts: 5,
    });

    expect(candidates.get('exhausted:refund')?.isLastAttempt).toBe(true);
    expect(candidates.get('fresh:refund')?.isLastAttempt).toBe(false);
  });

  it('filters budget-ineligible emails so refunds fill the batch', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_240_000);
    const email = row({
      claimed_at: '2026-07-21T00:00:00Z',
      order_id: 'order-1',
      step: 'customer_email',
    });
    const refund = row({
      claimed_at: '2026-07-22T00:00:00Z',
      order_id: 'order-2',
    });

    const candidates = selectCancellationDrainCandidates({
      deadlineMs: 1_270_000,
      deferredRows: [],
      failedRows: [email, refund],
      limit: 1,
      maxAttempts: 5,
    });

    expect([...candidates.keys()]).toEqual(['order-2:refund']);
  });

  it('keeps emails when the admission budget fits', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_200_000);
    const email = row({
      claimed_at: '2026-07-21T00:00:00Z',
      order_id: 'order-1',
      step: 'customer_email',
    });

    const candidates = selectCancellationDrainCandidates({
      deadlineMs: 1_270_000,
      deferredRows: [],
      failedRows: [email],
      limit: 1,
      maxAttempts: 5,
    });

    expect([...candidates.keys()]).toEqual(['order-1:customer_email']);
  });

  it('admits emails against the separate email cutoff', () => {
    // 30s to the side-effect deadline but 48s to the email cutoff:
    // after a full reconcile phase only the email deadline admits.
    vi.spyOn(Date, 'now').mockReturnValue(1_240_000);
    const email = row({
      claimed_at: '2026-07-21T00:00:00Z',
      order_id: 'order-1',
      step: 'customer_email',
    });

    const candidates = selectCancellationDrainCandidates({
      deadlineMs: 1_270_000,
      deferredRows: [],
      emailDeadlineMs: 1_288_000,
      failedRows: [email],
      limit: 1,
      maxAttempts: 5,
    });

    expect([...candidates.keys()]).toEqual(['order-1:customer_email']);
  });
});
