/** Customer wording does not equate a financed plan with merchant settlement. */
export function formatOrderStatus(
  status: string | null | undefined,
  paymentMethod?: string | null
) {
  if (
    paymentMethod === 'oxygen' &&
    status &&
    ['unpaid', 'pending', 'processing'].includes(status)
  )
    return 'Managed by Oxygen';
  if (!status) return 'Unavailable';
  return status
    .split('_')
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ');
}
