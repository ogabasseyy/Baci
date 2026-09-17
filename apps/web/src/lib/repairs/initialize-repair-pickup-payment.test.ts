import { beforeEach, expect, it, vi } from 'vitest';
import { initializeRepairPickupPayment } from './initialize-repair-pickup-payment';

const initialize = vi.hoisted(() => vi.fn());
vi.mock('@/lib/paystack', () => ({ initializeTransaction: initialize }));
beforeEach(() => vi.clearAllMocks());
const payload = {
  email: 'a@example.com',
  amount: 300000,
  reference: 'RPU-123',
};
const repair = { id: 'repair', ticketNumber: 42, resumeToken: 'token' };
it('persists the bound reference before a lost provider response and returns unknown', async () => {
  const checkpoint = vi.fn().mockResolvedValue(undefined);
  initialize.mockImplementation(async () => {
    expect(checkpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        reference: 'RPU-123',
        code: 'payment_initialization_unknown',
      })
    );
    throw new Error('response lost');
  });
  const result = await initializeRepairPickupPayment(
    payload,
    repair,
    checkpoint
  );
  expect(result).toMatchObject({
    success: false,
    code: 'payment_initialization_unknown',
    reference: 'RPU-123',
  });
  expect(initialize).toHaveBeenCalledTimes(1);
});
it('does not contact Paystack if its checkpoint cannot be persisted', async () => {
  await expect(
    initializeRepairPickupPayment(
      payload,
      repair,
      vi.fn().mockRejectedValue(new Error('storage'))
    )
  ).rejects.toThrow('storage');
  expect(initialize).not.toHaveBeenCalled();
});
it('returns the initialized checkout after a successful response', async () => {
  initialize.mockResolvedValue({
    authorization_url: 'https://checkout.paystack.com/test',
    reference: 'RPU-123',
  });
  expect(await initializeRepairPickupPayment(payload, repair)).toMatchObject({
    success: true,
    payment: { amount: 3000 },
  });
});
