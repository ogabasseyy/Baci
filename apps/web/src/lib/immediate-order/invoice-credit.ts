import type { ImmediateNotificationOrder } from './notification-context';

/**
 * Amount already covered by credit/partial payment: the same
 * credited-balance rule feeds the email transfer instructions, the
 * attached PDF, and the DVA skip guard, so credit already applied is
 * never charged again.
 */
export function getCreditedAmountPaid(
  order: ImmediateNotificationOrder,
  savingsAmountUsed: number,
  walletAmountUsed: number
) {
  return Math.max(
    Number(order.amount_paid || 0),
    savingsAmountUsed + walletAmountUsed
  );
}

export function getImmediateEmailAmountDue(
  orderTotal: number,
  creditedAmountPaid: number
) {
  return Math.max(orderTotal - creditedAmountPaid, 0);
}
