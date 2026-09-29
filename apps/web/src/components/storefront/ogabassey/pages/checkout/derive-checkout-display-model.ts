import type { CartItem } from '@/hooks/cart';
import type { CheckoutItem } from './components/DesktopOrderSummary';
import { resolveCheckoutStartValues } from './hooks/use-resumed-checkout-start-funnel';
import type { ResumedOrder } from './types';

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
  const resumedSubtotal = resumedOrder
    ? (resumedOrder.subtotal ??
      Math.max(
        0,
        resumedOrder.total -
          resumedOrder.shipping_cost -
          (resumedOrder.tax_amount ?? 0) -
          (resumedOrder.gift_wrapping_fee ?? 0) +
          (resumedOrder.discount_amount ?? 0)
      ))
    : undefined;
  // Resumed total is all-in; the summary's subtotal must remain the stamped
  // item subtotal so tax, delivery, and other order adjustments aren't added twice.
  const summarySubtotal = hasCheckoutCartItems
    ? effectiveCheckoutCartTotal
    : (resumedSubtotal ?? effectiveCheckoutCartTotal);

  return {
    displayItems,
    effectiveCheckoutCartTotal,
    effectiveItemSubtotal: hasCheckoutCartItems
      ? itemSubtotal
      : (resumedSubtotal ?? 0),
    summarySubtotal,
    hasCheckoutCartItems,
    summaryOrder: hasCheckoutCartItems ? null : resumedOrder,
    mobileSummaryCart: hasCheckoutCartItems
      ? checkoutCart
      : resumedOrderCartItems,
  };
}
