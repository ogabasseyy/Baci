export function startCustomerRepairPickupPayment(
  data: { serviceType?: string },
  expectedPickupFee: number
) {
  if (data.serviceType !== 'pickup' || expectedPickupFee !== 2500) {
    return Promise.resolve({
      success: false,
      code: 'validation_failed',
      error: 'Unexpected local pickup fixture input.',
    });
  }

  return Promise.resolve({
    success: true,
    id: 'local-repair-fixture',
    ticketNumber: 7421,
    payment: {
      amount: 2500,
      authorizationUrl: 'https://checkout.paystack.com/local-fixture-not-valid',
      reference: 'LOCAL-GIGL-REPAIR-FIXTURE',
    },
  });
}
