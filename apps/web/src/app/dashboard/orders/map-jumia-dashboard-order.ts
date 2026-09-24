import { formatPersonName } from '@/lib/format-person-name';
import type { PaymentStatus, ShippingStatus } from './order-statuses';

export interface JumiaOrderItem {
  id?: string;
  name?: string;
  price?: string | number;
  image_url?: string;
}

export interface JumiaOrder {
  jumia_order_id: string;
  jumia_order_number: string;
  jumia_shop_id: string | null;
  marketplace_key: string | null;
  customer_name: string | null;
  total_amount: string;
  status: string;
  created_at_jumia: string;
  items?: JumiaOrderItem[];
}

/** Normalize a cached Jumia order into the dashboard order shape. */
export function mapJumiaDashboardOrder(jOrder: JumiaOrder) {
  // Basic mapping of Jumia Status to Internal Status
  // Jumia: pending, shipped, delivered, canceled, failed
  let shippingStatus: ShippingStatus = 'Pending';
  let paymentStatus: PaymentStatus = 'Paid'; // Assumed paid to Jumia

  const startStatus = jOrder.status.toLowerCase();
  if (startStatus.includes('shipped')) shippingStatus = 'Shipped';
  if (startStatus.includes('delivered')) shippingStatus = 'Delivered';
  if (startStatus.includes('cancel')) {
    shippingStatus = 'Canceled';
    paymentStatus = 'Refunded';
  }
  if (startStatus.includes('fail')) shippingStatus = 'Canceled';

  return {
    id: jOrder.jumia_order_id, // Use Jumia ID as ID
    orderNumber: jOrder.jumia_order_number,
    jumiaShopId: jOrder.jumia_shop_id ?? undefined,
    jumiaMarketplaceKey: jOrder.marketplace_key ?? undefined,
    jumiaOrderId: jOrder.jumia_order_id ?? undefined,
    customerName: formatPersonName(jOrder.customer_name || 'Jumia Customer'),
    total: Number.parseFloat(jOrder.total_amount),
    currency: 'NGN',
    shippingStatus,
    paymentStatus,
    paymentMethod: 'Jumia Payout',
    date: new Date(jOrder.created_at_jumia).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }),
    createdAt: new Date(jOrder.created_at_jumia).getTime(),
    source: 'jumia',
    tracking_number: undefined,
    shipping_provider: 'Jumia Services',
    items: (jOrder.items || []).map((item: JumiaOrderItem, idx: number) => ({
      id: item.id || `jumia-item-${idx}`,
      name: item.name || 'Jumia Item',
      quantity: 1, // Usually Jumia lines are qty 1 per object in older APIs, check actual data structure.
      // For now assuming 1 if not specified.
      price: Number(item.price || 0),
      image: item.image_url,
      variant: undefined,
    })),
  };
}
