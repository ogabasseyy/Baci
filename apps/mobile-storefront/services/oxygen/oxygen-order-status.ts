export function isClosedOxygenShippingStatus(
  status: string | null | undefined
) {
  return [
    'cancelled',
    'canceled',
    'returned',
    'refunded',
    'delivered',
    'completed',
  ].includes(status ?? '');
}
