import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveAbandonedAttemptMismatch } from './resolve-abandoned-attempt-mismatch';

const mocks = vi.hoisted(() => ({
  fileTerminalAttemptEvidenceMismatch: vi.fn(),
}));

vi.mock('./file-terminal-attempt-evidence-mismatch', () => ({
  fileTerminalAttemptEvidenceMismatch:
    mocks.fileTerminalAttemptEvidenceMismatch,
}));

describe('resolveAbandonedAttemptMismatch', () => {
  const attempt = {
    amount: 100,
    currency: 'NGN',
    gateway_reference: 'BAC-OLD',
    id: 'attempt-1',
    merchant_id: 'merchant-1',
    metadata: {},
    order_id: 'order-1',
  };
  const hold = vi.fn();
  const supabase = {} as never;

  function terminalResult(status: string) {
    return {
      data: {
        amount: 9900,
        currency: 'NGN',
        reference: 'BAC-OLD',
        status,
      },
      success: true,
    } as never;
  }

  beforeEach(() => {
    vi.resetAllMocks();
    hold.mockResolvedValue(undefined);
    mocks.fileTerminalAttemptEvidenceMismatch.mockResolvedValue(true);
  });

  it.each([
    'abandoned',
    'failed',
  ])('files a %s mismatch and records the review', async (status) => {
    const reviewsFiled: string[] = [];

    await resolveAbandonedAttemptMismatch({
      attempt,
      hold,
      mismatchKind: 'payment_evidence_mismatch',
      result: terminalResult(status),
      reviewsFiled,
      supabase,
    });

    expect(mocks.fileTerminalAttemptEvidenceMismatch).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt,
        evidence: expect.objectContaining({
          mismatchKind: 'payment_evidence_mismatch',
          providerStatus: status,
        }),
      })
    );
    expect(reviewsFiled).toEqual(['attempt-1']);
    expect(hold).not.toHaveBeenCalled();
  });

  it('holds the attempt when filing fails', async () => {
    mocks.fileTerminalAttemptEvidenceMismatch.mockResolvedValue(false);
    const reviewsFiled: string[] = [];

    await resolveAbandonedAttemptMismatch({
      attempt,
      hold,
      mismatchKind: 'payment_evidence_mismatch',
      result: terminalResult('abandoned'),
      reviewsFiled,
      supabase,
    });

    expect(hold).toHaveBeenCalledWith('payment_evidence_mismatch');
    expect(reviewsFiled).toEqual([]);
  });

  it('holds a non-terminal mismatch without filing', async () => {
    const reviewsFiled: string[] = [];

    await resolveAbandonedAttemptMismatch({
      attempt,
      hold,
      mismatchKind: 'reference_mismatch',
      result: terminalResult('pending'),
      reviewsFiled,
      supabase,
    });

    expect(mocks.fileTerminalAttemptEvidenceMismatch).not.toHaveBeenCalled();
    expect(hold).toHaveBeenCalledWith('reference_mismatch');
    expect(reviewsFiled).toEqual([]);
  });
});
