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

  it.each([
    'PSK.1=x',
    'ref.with.dots',
    'ref=with=equals',
  ])('accepts Paystack references with dots and equals signs (%s)', async (transaction) => {
    mocks.paystackRequest.mockResolvedValue({ success: true });

    await initiateRefund(transaction, 10000);

    expect(mocks.paystackRequest).toHaveBeenCalledWith(
      '/refund',
      expect.objectContaining({
        body: JSON.stringify({ transaction, amount: 10000 }),
      })
    );
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

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])('rejects a non-finite amount instead of firing a full refund (%s)', async (amount) => {
    await expect(initiateRefund('PSK-1', amount)).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      success: false,
    });
    expect(mocks.paystackRequest).not.toHaveBeenCalled();
  });

  it('aborts the provider call at the callers timeout', async () => {
    mocks.paystackRequest.mockResolvedValue({ success: true });

    await initiateRefund('PSK-1', 10000, 'Order cancelled', 5000);

    expect(mocks.paystackRequest).toHaveBeenCalledWith(
      '/refund',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    const { signal } = mocks.paystackRequest.mock.calls[0][1] as {
      signal: AbortSignal;
    };
    expect(signal.aborted).toBe(false);
  });

  it('sends no abort signal without a timeout', async () => {
    mocks.paystackRequest.mockResolvedValue({ success: true });

    await initiateRefund('PSK-1', 10000, 'Order cancelled');

    expect(mocks.paystackRequest).toHaveBeenCalledWith('/refund', {
      body: '{"transaction":"PSK-1","amount":10000,"customer_note":"Order cancelled"}',
      method: 'POST',
    });
  });

  it.each([null, undefined, 'ok', 42])(
    'reports a successful envelope without refund data as ambiguous (%s)',
    async (data) => {
      mocks.paystackRequest.mockResolvedValue({ data, success: true });

      await expect(initiateRefund('PSK-1', 10000)).resolves.toMatchObject({
        code: 'MALFORMED_RESPONSE',
        success: false,
      });
    }
  );

  it('passes a well-formed success payload through', async () => {
    const data = {
      id: 101,
      status: 'queued',
      transaction: { id: 55, reference: 'PSK-1' },
    };
    mocks.paystackRequest.mockResolvedValue({ data, success: true });

    await expect(initiateRefund('PSK-1', 10000)).resolves.toEqual({
      data,
      success: true,
    });
  });
});
