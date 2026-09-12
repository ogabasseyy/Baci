import { describe, expect, it, vi } from 'vitest';
import { validRepairInput } from './repair.test-fixtures';
import { startCustomerRepairPickupPayment } from './repair-pickup-payment';

const mocks = vi.hoisted(() => ({
  startRepairPickupPayment: vi.fn(),
}));

vi.mock('@/lib/repairs/start-repair-pickup-payment', () => ({
  startRepairPickupPayment: mocks.startRepairPickupPayment,
}));

describe('startCustomerRepairPickupPayment', () => {
  it('binds the customer form, displayed fee, and storefront identity', async () => {
    mocks.startRepairPickupPayment.mockResolvedValueOnce({
      success: true,
      id: 'repair-1',
      ticketNumber: 42,
      payment: {
        amount: 8250,
        authorizationUrl: 'https://checkout.paystack.com/access-code',
        reference: 'RPU-ABC',
      },
    });

    await startCustomerRepairPickupPayment(
      { ...validRepairInput, serviceType: 'pickup' },
      8250,
      '123e4567-e89b-12d3-a456-426614174000',
      'ogabassey'
    );

    expect(mocks.startRepairPickupPayment).toHaveBeenCalledWith({
      data: { ...validRepairInput, serviceType: 'pickup' },
      expectedPickupFee: 8250,
      merchantId: '123e4567-e89b-12d3-a456-426614174000',
      merchantIdentifier: 'ogabassey',
      resumeToken: undefined,
    });
  });

  it('forwards a signed resume capability on retry', async () => {
    mocks.startRepairPickupPayment.mockResolvedValueOnce({
      success: true,
      id: 'repair-1',
      ticketNumber: 42,
      resumeToken: 'resume-token',
      payment: {
        amount: 8250,
        authorizationUrl: 'https://checkout.paystack.com/access-code',
        reference: 'RPU-ABC',
      },
    });

    await startCustomerRepairPickupPayment(
      { ...validRepairInput, serviceType: 'pickup' },
      8250,
      '123e4567-e89b-12d3-a456-426614174000',
      'ogabassey',
      'resume-token'
    );

    expect(mocks.startRepairPickupPayment).toHaveBeenCalledWith({
      data: { ...validRepairInput, serviceType: 'pickup' },
      expectedPickupFee: 8250,
      merchantId: '123e4567-e89b-12d3-a456-426614174000',
      merchantIdentifier: 'ogabassey',
      resumeToken: 'resume-token',
    });
  });
});
