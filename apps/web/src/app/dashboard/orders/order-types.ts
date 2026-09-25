import type { OrderFinancialFields } from '@/app/dashboard/orders/order-financials';
import type {
  PaymentStatus,
  ShippingStatus,
} from '@/app/dashboard/orders/order-statuses';
import type { MerchantPickupAddress } from '@/lib/shipping/merchant-rates/types';

export interface Transaction {
  id: string;
  reference?: string;
  gateway_reference?: string;
  status: string;
  amount: number;
  currency: string;
  gateway: string;
  created_at: string;
}

export interface Order extends OrderFinancialFields {
  id: string;
  orderNumber: string;
  customerName: string;
  total: number;
  /**
   * Order currency when recorded; null for legacy rows. Renderers fall back
   * to the merchant currency on null — mappers must not substitute a
   * synthetic default that would mislabel non-NGN merchants.
   */
  currency: string | null;
  shippingStatus: ShippingStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: string | null;
  date: string;
  createdAt: number;
  source: string;
  /** Jumia provider shop id, retained so multi-shop orders resolve their own integration. */
  jumiaShopId?: string;
  /** Jumia marketplace key, retained so same-shop business clients resolve their own integration. */
  jumiaMarketplaceKey?: string;
  /** Jumia provider order id for synced rows; fulfillment endpoints address this, not the local id. */
  jumiaOrderId?: string;
  tracking_number?: string;
  shipping_provider?: string;
  delivery_method?: string | null;
  airport_type?: string | null;
  shipping_rate_id?: string;
  shipping_rate_name?: string;
  /**
   * Durable snapshot of a merchant PICKUP rate's collection point captured at
   * purchase. Present only for merchant-pickup orders (provider
   * `MERCHANT_PICKUP`); null otherwise. Lets the merchant still see the pickup
   * point even after the rate is edited or deleted.
   */
  shipping_pickup_details?: MerchantPickupAddress | null;
  payment_reference?: string;
  customer_email?: string;
  customer_phone?: string;
  notes?: string;
  items: Array<{
    id: string;
    name: string;
    quantity: number;
    price: number;
    image?: string;
    variant?: string;
    hasAssurance?: boolean;
  }>;
  transactions?: Transaction[];
}

export interface OrderStats {
  totalOrders: number;
  completedOrders: number;
  unpaidOrders: number;
  urgentOrders: number;
}
