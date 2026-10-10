import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchPaystackPaymentById } from './fetch-paystack-payment-by-id';

const request = vi.hoisted(() => vi.fn());
vi.mock('@/lib/paystack-request', () => ({ paystackRequest: request }));

describe('fetchPaystackPaymentById', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ])('rejects invalid provider ID %s before a request', async (id) => {
    await expect(fetchPaystackPaymentById(id)).resolves.toMatchObject({
      success: false,
      code: 'VALIDATION_ERROR',
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('fetches a numeric Paystack payment and forwards the abort signal', async () => {
    const signal = new AbortController().signal;
    const provider = {
      success: true,
      data: { id: 555, reference: 'PSK-1' },
    };
    request.mockResolvedValue(provider);

    await expect(fetchPaystackPaymentById(555, signal)).resolves.toBe(provider);
    expect(request).toHaveBeenCalledWith('/transaction/555', { signal });
  });

  it('forwards provider failures without converting them to success', async () => {
    const failure = { success: false, code: 'NETWORK_ERROR' };
    request.mockResolvedValue(failure);

    await expect(fetchPaystackPaymentById(555)).resolves.toBe(failure);
  });
});
