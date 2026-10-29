import type { ExecuteResumedDirectPaymentOptions } from './handlers/direct-payment';

/** An existing order with no active cart can resume payment without a new quote. */
export function isResumedDirectPayment({
  resumedOrder,
  preferredGateway,
  checkoutItemCount,
}: Pick<
  ExecuteResumedDirectPaymentOptions,
  'resumedOrder' | 'preferredGateway'
> & { checkoutItemCount: number }): boolean {
  return Boolean(resumedOrder && preferredGateway && checkoutItemCount === 0);
}
