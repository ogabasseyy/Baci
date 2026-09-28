import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initiateRefund } from './initiate-paystack-refund';

const mocks = vi.hoisted(() => ({
  paystackRequest: vi.fn(),
}));

vi.mock('./paystack-request', () => ({
  paystackRequest: mocks.paystackRequest,
}));

describe('initiateRefund', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    '',
    'bad reference!',
    'x'.repeat(101),
  ])('rejects invalid transaction references (%s)', async (transaction) => {
    await expect(initiateRefund(transaction)).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      success: false,
    });
    expect(mocks.paystackRequest).not.toHaveBeenCalled();
  });

  it('forwards the refund with amount and reason', async () => {
    mocks.paystackRequest.mockResolvedValue({ success: true });

    await initiateRefund('PSK-1', 10000, 'Order cancelled');

    expect(mocks.paystackRequest).toHaveBeenCalledWith('/refund', {
      body: '{"transaction":"PSK-1","amount":10000,"customer_note":"Order cancelled"}',
      method: 'POST',
    });
  });

  it('omits non-positive amounts from the payload', async () => {
    mocks.paystackRequest.mockResolvedValue({ success: true });

    await initiateRefund('PSK-1', 0);

    expect(mocks.paystackRequest).toHaveBeenCalledWith(
      '/refund',
      expect.objectContaining({
        body: JSON.stringify({ transaction: 'PSK-1' }),
      })
    );
  });
});
