import {
  trackCheckoutStarted as trackAdCheckoutStarted,
  trackPaymentInfoAdded as trackAdPaymentInfoAdded,
  trackPurchase as trackAdPurchase,
} from '@/services/ad-tracking';
import {
  trackCheckoutStarted,
  trackOrderCompleted,
} from '@/services/analytics';

export interface CheckoutTrackingItem {
  name?: string;
  negotiatedPrice?: number | null;
  price?: number;
  product_id: string;
  quantity: number;
}

export interface CheckoutPurchaseInput {
  customerEmail?: string;
  customerPhone?: string;
  items?: CheckoutTrackingItem[];
  orderId: string;
  orderNumber?: string;
  paymentMethod: string;
  shipping?: number;
  subtotal?: number;
  tax?: number;
  total?: number;
  userId?: string;
}

function toAdItems(items: CheckoutTrackingItem[]) {
  return items.map((item) => ({
    id: item.product_id,
    name: item.name ?? item.product_id,
    price: item.negotiatedPrice ?? item.price ?? 0,
    quantity: item.quantity,
  }));
}

export function trackCheckoutRouteStarted({
  items,
  subtotal,
}: {
  items: CheckoutTrackingItem[];
  subtotal: number;
}) {
  const itemCount = items.reduce((acc, item) => acc + item.quantity, 0);
  trackCheckoutStarted({
    currency: 'NGN',
    itemCount,
    subtotal,
  });

  return trackAdCheckoutStarted({
    currency: 'NGN',
    itemCount,
    items: toAdItems(items),
    subtotal,
  });
}

export function trackCheckoutRoutePaymentInfo(paymentMethod: string) {
  return trackAdPaymentInfoAdded(paymentMethod);
}

export async function trackCheckoutRoutePurchaseCompleted({
  customerEmail,
  customerPhone,
  items = [],
  orderId,
  orderNumber = orderId,
  paymentMethod,
  total = 0,
  shipping = 0,
  subtotal = total,
  tax = 0,
  userId,
}: CheckoutPurchaseInput): Promise<void> {
  // Await the fallible ad purchase BEFORE the legacy order_completed
  // event: if the ad emission rejects, the shared completion claim rolls
  // back so a later poll or revisit can emit. Emitting order_completed
  // first would let that escaped event double-count the conversion on
  // retry, since a released claim cannot un-emit it.
  await trackAdPurchase({
    currency: 'NGN',
    email: customerEmail,
    items: toAdItems(items),
    orderId,
    orderNumber,
    paymentMethod,
    phone: customerPhone,
    shipping,
    subtotal,
    tax,
    total,
    userId,
  });

  trackOrderCompleted({
    currency: 'NGN',
    itemCount: items.reduce((acc, item) => acc + item.quantity, 0),
    orderId,
    orderNumber,
    paymentMethod,
    shipping,
    subtotal,
    tax,
    total,
  });
}
