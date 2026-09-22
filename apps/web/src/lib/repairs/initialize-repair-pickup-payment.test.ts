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
it('fences execution before persisting the unknown checkpoint and contacting Paystack', async () => {
  const order: string[] = [];
  const checkpoint = vi.fn().mockImplementation(async () => {
    order.push('checkpoint');
  });
  const onBeforeProviderInitialization = vi
    .fn()
    .mockImplementation(async () => {
      order.push('fence');
    });
  initialize.mockImplementation(async () => {
    order.push('provider');
    throw new Error('response lost');
  });
  const result = await initializeRepairPickupPayment(
    payload,
    repair,
    checkpoint,
    onBeforeProviderInitialization
  );
  expect(result).toMatchObject({
    success: false,
    code: 'payment_initialization_unknown',
  });
  expect(order).toEqual(['fence', 'checkpoint', 'provider']);
});
it('does not contact Paystack when execution fencing fails', async () => {
  const checkpoint = vi.fn().mockResolvedValue(undefined);
  await expect(
    initializeRepairPickupPayment(
      payload,
      repair,
      checkpoint,
      vi.fn().mockRejectedValue(new Error('claim changed'))
    )
  ).rejects.toThrow('claim changed');
  expect(initialize).not.toHaveBeenCalled();
  expect(checkpoint).not.toHaveBeenCalled();
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
it('persists the provider success before returning so a lost final write replays the receipt', async () => {
  const checkpoint = vi.fn().mockResolvedValue(undefined);
  initialize.mockResolvedValue({
    authorization_url: 'https://checkout.paystack.com/test',
    reference: 'RPU-123',
  });
  const result = await initializeRepairPickupPayment(
    payload,
    repair,
    checkpoint
  );
  expect(result).toMatchObject({ success: true });
  expect(checkpoint).toHaveBeenCalledTimes(2);
  expect(checkpoint).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({
      success: false,
      code: 'payment_initialization_unknown',
    })
  );
  expect(checkpoint).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({
      success: true,
      payment: expect.objectContaining({
        authorizationUrl: 'https://checkout.paystack.com/test',
      }),
    })
  );
});
it('still returns the in-memory success when the success checkpoint write fails', async () => {
  const checkpoint = vi
    .fn()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('transient'));
  initialize.mockResolvedValue({
    authorization_url: 'https://checkout.paystack.com/test',
    reference: 'RPU-123',
  });
  const result = await initializeRepairPickupPayment(
    payload,
    repair,
    checkpoint
  );
  expect(result).toMatchObject({
    success: true,
    payment: { authorizationUrl: 'https://checkout.paystack.com/test' },
  });
});
it('returns unknown when Paystack omits the checkout URL so reconciliation replays the receipt', async () => {
  const checkpoint = vi.fn().mockResolvedValue(undefined);
  initialize.mockResolvedValue({ reference: 'RPU-123' });
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
  expect(checkpoint).not.toHaveBeenCalledWith(
    expect.objectContaining({ success: true })
  );
});
it('returns unknown when Paystack echoes a different reference', async () => {
  const checkpoint = vi.fn().mockResolvedValue(undefined);
  initialize.mockResolvedValue({
    authorization_url: 'https://checkout.paystack.com/test',
    reference: 'RPU-OTHER',
  });
  const result = await initializeRepairPickupPayment(
    payload,
    repair,
    checkpoint
  );
  expect(result).toMatchObject({
    success: false,
    code: 'payment_initialization_unknown',
  });
  expect(checkpoint).not.toHaveBeenCalledWith(
    expect.objectContaining({ success: true })
  );
});
it('keeps the web failure contract for malformed provider responses without a checkpoint', async () => {
  initialize.mockResolvedValue({
    authorization_url: 'https://checkout.paystack.com/test',
    reference: 'RPU-OTHER',
  });
  const result = await initializeRepairPickupPayment(payload, repair);
  expect(result).toEqual({
    success: false,
    code: 'payment_initialization_failed',
    error:
      'Your repair request was saved, but payment could not start. Use your ticket to retry shortly.',
    ...repair,
  });
});
it('keeps the web failure contract for callers without a checkpoint', async () => {
  initialize.mockRejectedValue(new Error('provider down'));
  const result = await initializeRepairPickupPayment(payload, repair);
  expect(result).toEqual({
    success: false,
    code: 'payment_initialization_failed',
    error:
      'Your repair request was saved, but payment could not start. Use your ticket to retry shortly.',
    ...repair,
  });
});
