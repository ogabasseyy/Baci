import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchRefund } from './fetch-paystack-refund';

const mocks = vi.hoisted(() => ({
  paystackRequest: vi.fn(),
}));

vi.mock('@/lib/paystack-request', () => ({
  paystackRequest: mocks.paystackRequest,
}));

describe('fetchRefund', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects non-positive refund ids before calling Paystack', async () => {
    await expect(fetchRefund(0)).resolves.toMatchObject({
      success: false,
      code: 'VALIDATION_ERROR',
    });
    await expect(fetchRefund(-3)).resolves.toMatchObject({
      success: false,
      code: 'VALIDATION_ERROR',
    });
    expect(mocks.paystackRequest).not.toHaveBeenCalled();
  });

  it('forwards the refund lookup with its abort signal', async () => {
    const signal = AbortSignal.timeout(1000);
    mocks.paystackRequest.mockResolvedValue({ success: true });

    await fetchRefund(42, signal);

    expect(mocks.paystackRequest).toHaveBeenCalledWith('/refund/42', {
      signal,
    });
  });

  it('passes decimal-text ids through without numeric rounding', async () => {
    mocks.paystackRequest.mockResolvedValue({ success: true });
    const big = '9007199254740993';

    await fetchRefund(big);

    expect(mocks.paystackRequest).toHaveBeenCalledWith(`/refund/${big}`, {
      signal: undefined,
    });
    await expect(fetchRefund('not-an-id')).resolves.toMatchObject({
      success: false,
      code: 'VALIDATION_ERROR',
    });
  });
});
