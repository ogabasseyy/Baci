import { vi } from 'vitest';
import type {
  AlertSupabase,
  RefundAlertPassSummary,
  RefundReviewAlertSenders,
} from './refund-alert-types';

export const order = {
  currency: 'NGN',
  id: 'order-1',
  merchant_id: 'merchant-1',
  order_number: '1042',
};
export const merchant = { email: 'owner@example.com', id: 'merchant-1' };
export const review = {
  candidates: [{ amount: 27735, currency: 'NGN' }],
  id: 'review-1',
  metadata: { ambiguous_initiation: false } as unknown,
};

/** Promise that also exposes the builder's abortSignal(), like postgrest. */
export function withAbort<T>(promise: Promise<T>) {
  return Object.assign(promise, { abortSignal: () => promise });
}

export function makeSupabase(
  insertError: { code: string } | null = null,
  reclaimed: unknown[] = [{ review_id: 'review-1' }]
) {
  const insert = vi.fn(() =>
    withAbort(Promise.resolve({ error: insertError }))
  );
  const confirmEq = vi.fn().mockResolvedValue({ error: null });
  const reclaimChain = {
    eq: vi.fn(() => reclaimChain),
    is: vi.fn(() => reclaimChain),
    select: vi.fn(() =>
      withAbort(Promise.resolve({ data: reclaimed, error: null }))
    ),
  };
  const update = vi.fn((values: Record<string, unknown>) =>
    'confirmed_at' in values || typeof values.undeliverable_at === 'string'
      ? { eq: confirmEq }
      : reclaimChain
  );
  const del = vi.fn();
  const from = vi.fn(() => ({ delete: del, insert, update }));
  return { confirmEq, del, from, insert, reclaimChain, update };
}

export function makeSenders(
  overrides: Partial<RefundReviewAlertSenders> = {}
): RefundReviewAlertSenders {
  return {
    sendEmail: vi.fn().mockResolvedValue({ success: true }),
    sendPush: vi.fn().mockResolvedValue({ failed: 0, sent: 1 }),
    ...overrides,
  };
}

export const asSupabase = (s: ReturnType<typeof makeSupabase>) =>
  s as unknown as AlertSupabase;

export const emptyAlertSummary: RefundAlertPassSummary = {
  alerted: 0,
  attempted: 0,
  deferred: 0,
  duplicate: 0,
  failed: 0,
  uncertain: 0,
  undeliverable: 0,
};

/** Module mock factory for suites that only need the alert pass to no-op. */
export const alertModuleMock = async () => ({
  alertPendingRefundReviews: vi.fn().mockResolvedValue(emptyAlertSummary),
});
