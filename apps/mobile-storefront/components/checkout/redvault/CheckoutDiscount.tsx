import { CHECKOUT_MERCHANT_ID } from '../checkout-screen.constants';
import { type AppliedDiscount, DiscountCodeInput } from '../DiscountCodeInput';

interface Props {
  visible: boolean;
  subtotal: number;
  productIds: string[];
  appliedDiscount: AppliedDiscount | null;
  onChange: (discount: AppliedDiscount | null) => void;
}

export function CheckoutDiscount({
  visible,
  subtotal,
  productIds,
  appliedDiscount,
  onChange,
}: Props) {
  if (!visible) return null;
  return (
    <DiscountCodeInput
      merchantId={CHECKOUT_MERCHANT_ID}
      cartTotal={subtotal}
      productIds={productIds}
      appliedDiscount={appliedDiscount}
      onApply={onChange}
      onRemove={() => onChange(null)}
    />
  );
}
