import type { PaidTransaction } from '@/lib/payments/apply-paid-order-side-effects';
import type { createServiceClient } from '@/lib/supabase/service';

export type ServiceRoleClient = ReturnType<typeof createServiceClient>;

export type MerchantDetails = {
  business_name: string | null;
  cac_rc_number: string | null;
  email: string | null;
  email_sender_name: string | null;
  slug: string | null;
  support_email: string | null;
  tax_identification_number: string | null;
};

export type RichOrderItem = {
  condition?: string | null;
  id?: string | null;
  name: string | null;
  price: number | string | null;
  product_id?: string | null;
  quantity: number | null;
  variant_name: string | null;
};

export type PaymentStatus = 'paid' | 'pending' | 'failed' | 'cancelled';

export type RichPaidOrder = {
  ad_tracking?: Record<string, unknown> | null;
  currency?: string | null;
  customer_email?: string | null;
  customer_id?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  discount_amount: number;
  gift_wrapping_fee: number;
  id: string;
  merchant_id: string;
  order_items?: RichOrderItem[] | null;
  order_number?: string | null;
  payment_status: PaymentStatus;
  shipping_address?: {
    address?: string | null;
    city?: string | null;
    state?: string | null;
  } | null;
  shipping_fee: number;
  shipping_funding_source?: 'customer_checkout' | 'merchant_wallet' | null;
  shipping_provider?: string | null;
  shipping_platform_retained_amount?: number | string | null;
  subtotal: number;
  tax_amount: number;
  tax_basis: 'exclusive' | 'inclusive' | null;
  total: number;
};

export type PaidOrderSideEffectTransaction = PaidTransaction & {
  platform_fee?: number | null;
};

export type ScheduleAfter = (task: () => Promise<void>) => void;

export interface RunPaidOrderSideEffectsArgs {
  actor: string;
  allocatedGatewayFeeNgn?: number;
  externalGatewayReference: string;
  gatewayResponse: Record<string, unknown>;
  order: RichPaidOrder;
  scheduleAfter: ScheduleAfter;
  settlementGateway: 'juicyway' | 'korapay' | 'paystack';
  supabase: ServiceRoleClient;
  transaction: PaidOrderSideEffectTransaction;
}
