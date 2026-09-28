import type { CartItem } from '@/hooks/cart';
import type { CheckoutItem } from './components/DesktopOrderSummary';
import { resolveCheckoutStartValues } from './hooks/use-resumed-checkout-start-funnel';
import type { DeliveryMethod, ResumedOrder } from './types';

interface DeriveCheckoutSummaryAmountsInput {
  deliveryCost: number;
  deliveryMethod: DeliveryMethod | null;
  discountAmount: number;
  giftWrappingCost: number;
  hasCheckoutCartItems: boolean;
  orderTotals: { total: number; taxAmount: number } | null;
  resumedOrder: ResumedOrder | null;
}

/** Projects persisted resumed-order amounts into the summary display fields. */
export function deriveCheckoutSummaryAmounts({
  deliveryCost,
  deliveryMethod,
  discountAmount,
  giftWrappingCost,
  hasCheckoutCartItems,
  orderTotals,
  resumedOrder,
}: DeriveCheckoutSummaryAmountsInput) {
  const summaryOrder = hasCheckoutCartItems ? null : resumedOrder;
  const summaryTaxAmount =
    summaryOrder?.tax_amount ?? orderTotals?.taxAmount ?? 0;

  return {
    summaryOrder,
    summaryTaxAmount,
    summaryDeliveryCost: summaryOrder?.shipping_cost ?? deliveryCost,
    summaryGiftWrappingCost:
      summaryOrder?.gift_wrapping_fee ?? giftWrappingCost,
    summaryDiscountAmount: summaryOrder?.discount_amount ?? discountAmount,
    summaryDeliveryMethod: summaryOrder ? null : deliveryMethod,
    summaryOrderTotals: summaryOrder
      ? { total: summaryOrder.total, taxAmount: summaryTaxAmount }
      : orderTotals,
    // The persisted amount may have been calculated with a historical or
    // merchant-specific rate, so do not attach the current default rate.
    summaryTaxLabel: summaryOrder ? 'Tax' : 'VAT (7.5%)',
  };
}

interface DeriveCheckoutDisplayModelInput {
  checkoutCart: CartItem[];
  checkoutCartTotal: number;
  currencyCode: string;
  itemSubtotal: number;
  resumedOrder: ResumedOrder | null;
}

/** Projects cart and resumed-order data into the two checkout summary shapes. */
export function deriveCheckoutDisplayModel({
  checkoutCart,
  checkoutCartTotal,
  currencyCode,
  itemSubtotal,
  resumedOrder,
}: DeriveCheckoutDisplayModelInput) {
  const hasCheckoutCartItems = checkoutCart.length > 0;
  const displayItems: CheckoutItem[] = hasCheckoutCartItems
    ? checkoutCart.map((item) => ({ kind: 'cart' as const, ...item }))
    : (resumedOrder?.items ?? []).map((item) => ({
        kind: 'resumed' as const,
        ...item,
      }));
  const resumedOrderCartItems: CartItem[] =
    !hasCheckoutCartItems && resumedOrder
      ? resumedOrder.items.map((item) => ({
          brand: '',
          cartItemId: item.id,
          description: '',
          gtin: '',
          id: item.product_id || item.id,
          image: item.image_url || '',
          imageHint: item.product_name,
          imageLarge: item.image_url || '',
          manage_stock: false,
          mpn: '',
          name: item.product_name,
          price: item.price,
          quantity: item.quantity,
          status: 'active',
          stock: item.quantity,
        }))
      : [];
  const { total: effectiveCheckoutCartTotal } = resolveCheckoutStartValues({
    checkoutCartTotal,
    currencyCode,
    hasCheckoutCartItems,
    resumedOrder,
  });
  // Resumed total is all-in; the summary's subtotal must remain the stamped
  // item subtotal so tax, delivery, and other order adjustments aren't added twice.
  const summarySubtotal = hasCheckoutCartItems
    ? effectiveCheckoutCartTotal
    : (resumedOrder?.subtotal ?? effectiveCheckoutCartTotal);

  return {
    displayItems,
    effectiveCheckoutCartTotal,
    effectiveItemSubtotal: hasCheckoutCartItems
      ? itemSubtotal
      : resumedOrder?.subtotal || 0,
    summarySubtotal,
    hasCheckoutCartItems,
    summaryOrder: hasCheckoutCartItems ? null : resumedOrder,
    mobileSummaryCart: hasCheckoutCartItems
      ? checkoutCart
      : resumedOrderCartItems,
  };
}
