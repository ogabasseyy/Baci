import type { PaymentMethodType } from '@/components/checkout/PaymentMethodSelector';
import type { AppliedDiscount } from '../DiscountCodeInput';

export function getRedvaultCompatibleDiscount(
  paymentMethod: PaymentMethodType | null,
  discount: AppliedDiscount | null
): AppliedDiscount | null {
  return paymentMethod === 'uba_redvault' ? null : discount;
}
