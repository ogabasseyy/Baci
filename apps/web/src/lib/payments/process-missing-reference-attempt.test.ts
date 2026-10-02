import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fileInvalidAttemptReference: vi.fn(),
}));

vi.mock('./file-invalid-attempt-reference', () => ({
  fileInvalidAttemptReference: mocks.fileInvalidAttemptReference,
}));

import { processMissingReferenceAttempt } from './process-missing-reference-attempt';
import type { AbandonedPaystackAttemptSummary } from './reconcile-abandoned-paystack-attempts';

const attempt = {
  gateway_reference: null,
  id: 'attempt-1',
  merchant_id: 'merchant-1',
  metadata: null,
  order_id: 'order-1',
};

function summary(): AbandonedPaystackAttemptSummary {
  return {
    checked: 1,
    completed: [],
    failed: false,
    held: [],
    retired: [],
    reviewsFiled: [],
  };
}

describe('processMissingReferenceAttempt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('files the missing reference and records the review', async () => {
    mocks.fileInvalidAttemptReference.mockResolvedValue(true);
    const current = summary();
    const hold = vi.fn();

    await processMissingReferenceAttempt({} as never, attempt, {
      hold,
      summary: current,
    });

    expect(mocks.fileInvalidAttemptReference).toHaveBeenCalledWith({
      attempt,
      reason: 'gateway_reference_missing',
      supabase: {},
    });
    expect(current.reviewsFiled).toEqual(['attempt-1']);
    expect(current.failed).toBe(false);
    expect(hold).not.toHaveBeenCalled();
  });

  it('holds for invalid reference when filing fails', async () => {
    mocks.fileInvalidAttemptReference.mockResolvedValue(false);
    const current = summary();
    const hold = vi.fn().mockResolvedValue(undefined);

    await processMissingReferenceAttempt({} as never, attempt, {
      hold,
      summary: current,
    });

    expect(current.reviewsFiled).toEqual([]);
    expect(current.failed).toBe(true);
    expect(hold).toHaveBeenCalledWith('invalid_reference');
  });
});
