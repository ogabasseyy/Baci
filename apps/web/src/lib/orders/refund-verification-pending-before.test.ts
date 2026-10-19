import { afterEach, describe, expect, it, vi } from 'vitest';

import { isRefundVerificationPendingBefore } from './refund-verification-pending';

function chain(result: { data: unknown; error: Error | null }) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of [
    'select',
    'eq',
    'lt',
    'in',
    'gt',
    'ilike',
    'order',
    'abortSignal',
  ]) {
    query[method] = vi.fn().mockReturnValue(query);
  }
  query.limit = vi.fn().mockResolvedValue(result);
  return query;
}
describe('isRefundVerificationPendingBefore', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fails closed at the deadline when reads hang instead of erroring', async () => {
    vi.useFakeTimers();
    const hanging = () => new Promise<never>(() => {});
    const abortSignals: AbortSignal[] = [];
    const from = vi.fn().mockImplementation(() => {
      const query: Record<string, unknown> = {};
      for (const method of [
        'select',
        'eq',
        'lt',
        'in',
        'gt',
        'ilike',
        'order',
      ]) {
        (query as Record<string, unknown>)[method] = vi
          .fn()
          .mockReturnValue(query);
      }
      query.abortSignal = vi.fn().mockImplementation((signal: AbortSignal) => {
        abortSignals.push(signal);
        return query;
      });
      query.limit = vi.fn().mockImplementation(hanging);
      return query;
    });
    const supabase = { from } as never;

    const pending = isRefundVerificationPendingBefore(
      supabase,
      Date.now() + 500
    );
    await vi.advanceTimersByTimeAsync(500);
    // Fail closed (capped): the slow probe degrades the reconcile
    // phase instead of consuming the invocation.
    await expect(pending).resolves.toBe(true);
    // The losing probe is aborted, not merely abandoned: every
    // issued query carried the same signal, and the deadline
    // aborted it so postgrest cancels the orphaned reads.
    expect(abortSignals.length).toBeGreaterThan(0);
    for (const signal of abortSignals) {
      expect(signal.aborted).toBe(true);
    }
  });

  it('passes through a fast probe result before the deadline', async () => {
    vi.useFakeTimers();
    const from = vi
      .fn()
      .mockReturnValueOnce(chain({ data: [], error: null }))
      .mockReturnValueOnce(chain({ data: [], error: null }));
    const supabase = { from } as never;

    await expect(
      isRefundVerificationPendingBefore(supabase, Date.now() + 10_000)
    ).resolves.toBe(false);
  });

  it('fails closed when the probe throws before the deadline', async () => {
    const from = vi.fn().mockImplementation(() => {
      throw new Error('transport down');
    });
    const supabase = { from } as never;

    await expect(
      isRefundVerificationPendingBefore(supabase, Date.now() + 10_000)
    ).resolves.toBe(true);
  });

  it('fails closed immediately when the deadline already passed', async () => {
    const from = vi.fn();
    const supabase = { from } as never;

    await expect(
      isRefundVerificationPendingBefore(supabase, Date.now() - 1)
    ).resolves.toBe(true);
    expect(from).not.toHaveBeenCalled();
  });
});
