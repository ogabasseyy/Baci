export function isRepairPickupPaymentConfirmed(status: string | undefined) {
  // 'retrying' means payment is confirmed but GIGL booking is being retried:
  // the customer paid and must keep back-navigation like any paid pickup.
  return ['paid', 'booked', 'retrying', 'review', 'manual_fulfilled'].includes(
    status ?? ''
  );
}
