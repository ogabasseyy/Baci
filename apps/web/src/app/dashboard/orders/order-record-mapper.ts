import { formatPersonName } from '@/lib/format-person-name';
import type { MerchantPickupAddress } from '@/lib/shipping/merchant-rates/types';
import { mapOrderFinancialFields } from './order-financials';
import type { PaymentStatus, ShippingStatus } from './order-statuses';

interface DashboardOrderItem {
  id: string;
  name?: string;
  product_id?: string | null;
  image_url?: string | null;
  quantity: number;
  price?: string | number;
  variant_name?: string;
  has_assurance?: boolean;
}

export interface DashboardOrderRecord {
  id: string;
  order_number: string;
  customer_name: string;
  total: string;
  subtotal?: string | number | null;
  shipping_fee?: string | number | null;
  gift_wrapping_fee?: string | number | null;
  tax_amount?: string | number | null;
  tax_basis?: string | null;
  discount_amount?: string | number | null;
  currency?: string | null;
  shipping_status: string;
  payment_status: string;
  payment_method: string | null;
  created_at: string;
  source: string;
  tracking_number?: string;
  shipping_provider?: string;
  delivery_method?: string | null;
  airport_type?: string | null;
  shipping_rate_id?: string | null;
  shipping_rate_name?: string | null;
  shipping_pickup_details?: MerchantPickupAddress | null;
  payment_reference?: string;
  customer_email?: string;
  customer_phone?: string;
  notes?: string;
  order_items?: DashboardOrderItem[];
  import_metadata?: {
    shopId?: unknown;
    jumiaOrderId?: unknown;
    [key: string]: unknown;
  } | null;
}

interface DashboardTransactionRecord {
  id: string;
  reference?: string;
  gateway_reference?: string;
  status: string;
  amount: number;
  currency: string;
  gateway: string;
  created_at: string;
}

interface MapDashboardOrderRecordOptions {
  includeDetails?: boolean;
  orderItemImageMap: ReadonlyMap<string, string>;
  transactions?: readonly DashboardTransactionRecord[] | null;
}

function formatStatus(status: string): string {
  if (!status) return 'Pending';
  return status
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Map a dashboard order row while keeping fulfillment metadata in one place. */
export function mapDashboardOrderRecord(
  order: DashboardOrderRecord,
  {
    includeDetails = false,
    orderItemImageMap,
    transactions,
  }: MapDashboardOrderRecordOptions
) {
  const mappedOrder = {
    id: order.id,
    orderNumber: order.order_number,
    customerName: formatPersonName(order.customer_name || 'Customer'),
    total: Number.parseFloat(order.total),
    ...mapOrderFinancialFields(order),
    currency: order.currency || 'NGN',
    shippingStatus: formatStatus(order.shipping_status) as ShippingStatus,
    paymentStatus: formatStatus(order.payment_status) as PaymentStatus,
    paymentMethod: order.payment_method,
    date: new Date(order.created_at).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }),
    createdAt: new Date(order.created_at).getTime(),
    source: order.source,
    // Synced marketplace rows carry their provider shop in import
    // metadata; surface it so multi-shop orders resolve their own
    // integration for fulfillment.
    jumiaShopId:
      typeof order.import_metadata?.shopId === 'string'
        ? order.import_metadata.shopId
        : undefined,
    // Two integrations can share one shop id across business clients;
    // the marketplace key disambiguates them for fulfillment.
    jumiaMarketplaceKey:
      typeof order.import_metadata?.marketplaceKey === 'string'
        ? order.import_metadata.marketplaceKey
        : undefined,
    // The fulfillment modal addresses Jumia by provider order ID, while
    // the mapped id stays the local order UUID; legacy cache rows already
    // use the provider ID as their id.
    jumiaOrderId:
      typeof order.import_metadata?.jumiaOrderId === 'string'
        ? order.import_metadata.jumiaOrderId
        : undefined,
    tracking_number: order.tracking_number,
    shipping_provider: order.shipping_provider,
    delivery_method: order.delivery_method,
    airport_type: order.airport_type,
    items: (order.order_items || []).map((item) => ({
      id: item.id,
      name: item.name || 'Unknown Product',
      quantity: item.quantity,
      price: Number.parseFloat(String(item.price || 0)),
      image: item.image_url
        ? item.image_url
        : item.product_id
          ? orderItemImageMap.get(item.product_id)
          : undefined,
      variant: item.variant_name || undefined,
      hasAssurance: item.has_assurance || false,
    })),
    ...(includeDetails
      ? {
          shipping_rate_id: order.shipping_rate_id ?? undefined,
          shipping_rate_name: order.shipping_rate_name ?? undefined,
          shipping_pickup_details: order.shipping_pickup_details ?? undefined,
          payment_reference: order.payment_reference,
          customer_email: order.customer_email,
          customer_phone: order.customer_phone,
          notes: order.notes,
        }
      : {}),
    ...(transactions
      ? {
          transactions: transactions.map((transaction) => ({
            id: transaction.id,
            reference:
              transaction.reference || transaction.gateway_reference || '',
            status: transaction.status,
            amount: transaction.amount,
            currency: transaction.currency,
            gateway: transaction.gateway,
            created_at: transaction.created_at,
          })),
        }
      : {}),
  };

  return mappedOrder;
}
