import { describe, expect, it, vi } from 'vitest';
import { submitNextPetrockEligibilityCheck } from './petrock-eligibility-engine';

describe('carrier eligibility product identity', () => {
  it('suppresses a catalog response for a different product before submitting', async () => {
    const getAccount = vi.fn();
    const submitOrder = vi.fn();
    const begin = vi.fn();
    const readProduct = vi.fn().mockResolvedValue({
      active: true,
      currency: 'USD',
      orderFieldName: 'IMEI',
      priceUsd: 0.07,
      productId: '716',
      syncedAt: new Date().toISOString(),
    });
    const result = await submitNextPetrockEligibilityCheck({
      client: { getAccount, submitOrder },
      identifier: '490154203237518',
      order: {
        id: 'order-1',
        eligibilityChecksCompleted: [],
        eligibilityEvidence: { blacklistStatus: 'Clean', simLock: 'Locked' },
      },
      origin: 'https://ogabassey.com',
      readProduct,
      state: {
        begin,
        markSubmissionUnknown: vi.fn(),
        recordSubmission: vi.fn(),
        suppress: vi.fn().mockResolvedValue(true),
      },
    });
    expect(readProduct).toHaveBeenCalledWith('689');
    expect(result).toMatchObject({
      kind: 'suppressed',
      reason: 'house_check_unavailable',
    });
    expect(getAccount).not.toHaveBeenCalled();
    expect(begin).not.toHaveBeenCalled();
    expect(submitOrder).not.toHaveBeenCalled();
  });
});
