import type { ResumedOrder } from '../types';
import {
  useCheckoutStartFunnel,
  type CheckoutStartFunnelItem,
} from './use-checkout-start-funnel';

export interface CheckoutStartValuesInput {
  checkoutCartTotal: number;
  currencyCode: string;
  hasCheckoutCartItems: boolean;
  resumedOrder: ResumedOrder | null;
}

/**
 * Shared derivation behind the checkout start: a resumed start replays
 * a stamped order, not a live cart, so it reports the canonical total
 * (shipping, tax, wrapping, and discounts included) and the stamped
 * currency — matching the resumed payment_started and completion
 * events. The subtotal-only/merchant-currency variant would split one
 * attempt across inconsistent values and relabel history after a
 * merchant currency change.
 */
export function resolveCheckoutStartValues({
  checkoutCartTotal,
  currencyCode,
  hasCheckoutCartItems,
  resumedOrder,
}: CheckoutStartValuesInput): { total: number; currency: string } {
  return {
    total: hasCheckoutCartItems
      ? checkoutCartTotal
      : (resumedOrder?.total ?? checkoutCartTotal),
    currency:
      !hasCheckoutCartItems && resumedOrder?.currency
        ? resumedOrder.currency
        : currencyCode,
  };
}

type UseResumedCheckoutStartFunnelParams = CheckoutStartValuesInput & {
  attemptId?: string;
  displayItems: CheckoutStartFunnelItem[];
  effectiveItemSubtotal: number;
  isHydrated: boolean;
  merchantId?: string;
};

/**
 * `checkout_started` instrumentation for the checkout page, using the
 * shared derivation above so the funnel event and the rendered totals
 * can never disagree on a resumed start.
 */
export function useResumedCheckoutStartFunnel({
  attemptId,
  checkoutCartTotal,
  currencyCode,
  displayItems,
  effectiveItemSubtotal,
  hasCheckoutCartItems,
  isHydrated,
  merchantId,
  resumedOrder,
}: UseResumedCheckoutStartFunnelParams): void {
  const { total: effectiveCheckoutCartTotal, currency: effectiveCheckoutCurrency } =
    resolveCheckoutStartValues({
      checkoutCartTotal,
      currencyCode,
      hasCheckoutCartItems,
      resumedOrder,
    });
  useCheckoutStartFunnel({
    attemptId,
    currency: effectiveCheckoutCurrency,
    displayItems,
    effectiveCheckoutCartTotal,
    effectiveItemSubtotal,
    isHydrated,
    merchantId,
  });
}
