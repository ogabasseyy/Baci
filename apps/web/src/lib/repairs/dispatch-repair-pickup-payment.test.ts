import { describe, expect, it, vi } from 'vitest';
import { dispatchRepairPickupPayment } from './dispatch-repair-pickup-payment';

const mocks = vi.hoisted(() => ({ handle: vi.fn() }));

vi.mock('./handle-repair-pickup-payment', () => ({
  handleRepairPickupPayment: mocks.handle,
}));

const options = {
  gateway: 'paystack' as const,
  gatewayResponse: { status: true },
  reference: 'RPU-TEST',
  supabase: {} as never,
  verifiedAmount: 8250,
};

describe('dispatchRepairPickupPayment', () => {
  it('returns the repair response when the payment is handled', async () => {
    mocks.handle.mockResolvedValueOnce({
      body: { success: true },
      handled: true,
      status: 200,
    });

    const response = await dispatchRepairPickupPayment(options);

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({ success: true });
  });

  it('returns null so unrelated payments continue through the webhook', async () => {
    mocks.handle.mockResolvedValueOnce({ handled: false });

    await expect(dispatchRepairPickupPayment(options)).resolves.toBeNull();
  });

  it('propagates handler failures so the webhook returns a retryable error', async () => {
    mocks.handle.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(dispatchRepairPickupPayment(options)).rejects.toThrow(
      'database unavailable'
    );
  });
});
