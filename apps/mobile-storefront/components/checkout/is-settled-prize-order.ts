import type { CartItem } from '@/stores/cart-store';
import { cartHasVoucherLine } from './checkout-prize-cart-guard';

/**
 * True when a just-created order is a quiz prize the server has already
 * settled: paid, with nothing due to any gateway. Such an order must go
 * straight to success; no payment-method flow may run for it, whatever
 * method happened to be selected on the payment step.
 */
export function isSettledPrizeOrder({
  amountDueToGateway,
  itemsSnapshot,
  paymentStatus,
}: {
  amountDueToGateway: unknown;
  itemsSnapshot: CartItem[] | undefined;
  paymentStatus: unknown;
}): boolean {
  return (
    cartHasVoucherLine(itemsSnapshot ?? []) &&
    paymentStatus === 'paid' &&
    Number(amountDueToGateway ?? 0) <= 0
  );
}
