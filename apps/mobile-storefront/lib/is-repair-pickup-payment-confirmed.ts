export function isRepairPickupPaymentConfirmed(status: string | undefined) {
  // 'retrying' means payment is confirmed but GIGL booking is being retried:
  // the customer paid and must keep back-navigation like any paid pickup.
  // 'booking' is post-payment (carrier booking in flight): the checkout hides
  // the payment action for it, so back-navigation must stay enabled too.
  return [
    'paid',
    'booking',
    'booked',
    'retrying',
    'review',
    'manual_fulfilled',
  ].includes(status ?? '');
}
