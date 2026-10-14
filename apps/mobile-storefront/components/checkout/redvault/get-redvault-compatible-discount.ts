import type { PaymentMethodType } from '@/components/checkout/PaymentMethodSelector';
import type { AppliedDiscount } from '../DiscountCodeInput';

export function getRedvaultCompatibleDiscount(
  paymentMethod: PaymentMethodType | null,
  discount: AppliedDiscount | null
): AppliedDiscount | null {
  return paymentMethod === 'uba_redvault' ? null : discount;
}

/** Displayed totals never drop below zero after the discount. */
export function discountedCheckoutTotal(
  total: number,
  discount: AppliedDiscount | null
): number {
  return Math.max(0, total - (discount?.discountAmount ?? 0));
}
