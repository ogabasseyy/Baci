import { describe, expect, it, vi } from 'vitest';
import {
  clearDuplicateCaptureReviewPending,
  setDuplicateCaptureReviewPending,
} from './duplicate-capture-review-pending';

describe('duplicate-capture-review-pending', () => {
  it('sets the retry marker through the atomic RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });

    await expect(
      setDuplicateCaptureReviewPending({ rpc } as never, 'attempt-1')
    ).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      'set_duplicate_capture_review_pending_v1',
      { p_pending: true, p_transaction_id: 'attempt-1' }
    );
  });

  it('clears the retry marker once the review lands', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });

    await expect(
      clearDuplicateCaptureReviewPending({ rpc } as never, 'attempt-1')
    ).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      'set_duplicate_capture_review_pending_v1',
      { p_pending: false, p_transaction_id: 'attempt-1' }
    );
  });

  it.each([
    { data: false, error: null },
    { data: true, error: { message: 'db down' } },
  ])('reports false without throwing on %j', async (resolution) => {
    const rpc = vi.fn().mockResolvedValue(resolution);

    await expect(
      setDuplicateCaptureReviewPending({ rpc } as never, 'attempt-1')
    ).resolves.toBe(false);
  });

  it('reports false when the RPC transport throws', async () => {
    const rpc = vi.fn().mockRejectedValue(new Error('connection reset'));

    await expect(
      clearDuplicateCaptureReviewPending({ rpc } as never, 'attempt-1')
    ).resolves.toBe(false);
  });
});
