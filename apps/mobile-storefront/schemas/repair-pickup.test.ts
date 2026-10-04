import { repairPickupSchemas } from './repair-pickup';

describe('repairPickupSchemas', () => {
  it('allows resumable payment failures', () => {
    expect(
      repairPickupSchemas.payment.safeParse({
        success: false,
        error: 'Retry',
        code: 'payment_initialization_failed',
        resumeToken: 'token',
      }).success
    ).toBe(true);
  });
  it('rejects an unrecognized payment lifecycle', () => {
    expect(
      repairPickupSchemas.status.safeParse({
        found: true,
        repair: {
          status: 'pending',
          ticketNumber: 123,
          trackingNumber: null,
          pickupPaymentStatus: 'fake',
        },
      }).success
    ).toBe(false);
  });
});
