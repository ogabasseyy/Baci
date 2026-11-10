/** Reject direct gateway initialization for an order assigned to Oxygen. */
export function rejectOxygenGatewayInitialization(paymentMethod: unknown) {
  if (paymentMethod !== 'oxygen') return null;

  return {
    code: 'OXYGEN_PAYMENT_IN_PROGRESS',
    message:
      'This order is using Oxygen. Continue your existing payment application.',
    status: 409,
  };
}
