import {
  trackCheckoutStarted as trackAdCheckoutStarted,
  trackPaymentInfoAdded as trackAdPaymentInfoAdded,
  trackPurchase as trackAdPurchase,
} from '@/services/ad-tracking';
import {
  trackCheckoutStarted,
  trackOrderCompleted,
} from '@/services/analytics';

interface CheckoutTrackingItem {
  name?: string;
  negotiatedPrice?: number | null;
  price?: number;
  product_id: string;
  quantity: number;
}

export interface CheckoutPurchaseInput {
  customerEmail?: string;
  customerPhone?: string;
  items: CheckoutTrackingItem[];
  orderId: string;
  orderNumber: string;
  paymentMethod: string;
  shipping: number;
  subtotal: number;
  tax: number;
  total: number;
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

export function trackCheckoutRoutePurchaseCompleted({
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
}: CheckoutPurchaseInput) {
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

  return trackAdPurchase({
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
}
