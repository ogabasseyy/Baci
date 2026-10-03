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
});
