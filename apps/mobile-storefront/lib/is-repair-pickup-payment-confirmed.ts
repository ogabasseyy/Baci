export function isRepairPickupPaymentConfirmed(status: string | undefined) {
  return ['paid', 'booked', 'review', 'manual_fulfilled'].includes(
    status ?? ''
  );
}
