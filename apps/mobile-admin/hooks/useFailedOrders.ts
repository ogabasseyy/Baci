import { useQuery } from '@tanstack/react-query';
import {
  FOLLOW_UP_QUERY_LIMIT,
  FOLLOW_UP_WINDOW_DAYS,
  STALE_PENDING_MINUTES,
} from '@/config/follow-up-queue';
import { supabase } from '@/lib/supabase';
import type { OxygenFollowUpStatus } from '@/schemas/oxygen-follow-up';
import {
  CUSTOMER_CHECKOUT_ORDER_FILTER,
  ONLINE_CHECKOUT_PAYMENT_METHODS,
} from './orders/order-list-visibility';
import { useMerchant } from './useMerchant';

export interface FailedOrder {
  id: string;
  order_number: string;
  customer_id: string | null;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  total: number | null;
  payment_status:
    | 'bnpl_pending'
    | 'bnpl_approved'
    | 'failed'
    | 'pending'
    | 'expired'
    | 'unpaid'
    | 'paid'
    | 'refunded'
    | 'cancelled'
    | 'unknown';
  payment_method: string;
  created_at: string;
  gateway_response?: Record<string, unknown> | null;
  gateway?: string;
  attempt_count: number;
  oxygen_follow_up_status?: OxygenFollowUpStatus;
  follow_up_at?: string;
  staff_follow_up_only?: boolean;
}

type FailedOrderPaymentStatus = FailedOrder['payment_status'];

const VALID_PAYMENT_STATUSES: ReadonlySet<FailedOrderPaymentStatus> = new Set([
  'bnpl_pending',
  'failed',
  'pending',
  'expired',
  'unpaid',
]);

const toPaymentStatus = (status: string): FailedOrderPaymentStatus => {
  return VALID_PAYMENT_STATUSES.has(status as FailedOrderPaymentStatus)
    ? (status as FailedOrderPaymentStatus)
    : 'unknown';
};

/** Shape returned by the Supabase select on orders with joined transactions */
interface FailedOrderRow {
  id: string;
  order_number: string;
  customer_id: string | null;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string;
  total: number;
  payment_status: string;
  payment_method: string;
  created_at: string;
  transactions: {
    gateway_response: Record<string, unknown> | null;
    status: string;
    gateway: string;
  }[];
}

/**
 * `orders` and `transactions` are joined by two foreign keys:
 * - `transactions_order_id_fkey`      transactions.order_id -> orders.id (the payment attempts)
 * - `orders_paid_transaction_id_fkey` orders.paid_transaction_id -> transactions.id (the settling attempt)
 *
 * PostgREST refuses an ambiguous embed (PGRST201) and fails the whole request,
 * so the attempt-history relationship must be named explicitly.
 */
const FAILED_ORDER_TRANSACTIONS_RELATIONSHIP =
  'transactions!transactions_order_id_fkey';

export function useFailedOrders() {
  const { merchant } = useMerchant();
  const merchantId = merchant?.id;

  const query = useQuery({
    queryKey: ['failed-orders', merchantId, 'v2'],
    queryFn: async () => {
      const staleCutoff = new Date(
        Date.now() - STALE_PENDING_MINUTES * 60 * 1000
      ).toISOString();
      const windowStart = new Date(
        Date.now() - FOLLOW_UP_WINDOW_DAYS * 24 * 60 * 60 * 1000
      ).toISOString();

      // Fetch orders that need merchant follow-up, within the last
      // FOLLOW_UP_WINDOW_DAYS:
      // - failed: payment attempt failed (card declined, etc.)
      // - bnpl_pending: BNPL started but not completed
      // - expired: DVA/payment link expired without payment
      // - pending/unpaid online checkout older than 30min: likely abandoned online checkout
      const { data, error } = await supabase
        .from('orders')
        .select(`
          id,
          order_number,
          customer_id,
          customer_name,
          customer_email,
          customer_phone,
          total,
          payment_status,
          payment_method,
          created_at,
          ${FAILED_ORDER_TRANSACTIONS_RELATIONSHIP} (
            gateway_response,
            status,
            gateway
          )
        `)
        .eq('merchant_id', merchantId)
        .gte('created_at', windowStart)
        .or(
          `and(payment_status.in.(bnpl_pending,failed,expired),or(payment_method.is.null,payment_method.not.in.(oxygen))),and(payment_status.eq.pending,created_at.lt.${staleCutoff},payment_method.in.${ONLINE_CHECKOUT_PAYMENT_METHODS},${CUSTOMER_CHECKOUT_ORDER_FILTER}),and(payment_status.eq.unpaid,created_at.lt.${staleCutoff},payment_method.in.${ONLINE_CHECKOUT_PAYMENT_METHODS},${CUSTOMER_CHECKOUT_ORDER_FILTER})`
        )
        .order('created_at', { ascending: false })
        .limit(FOLLOW_UP_QUERY_LIMIT + 1);

      if (error) throw error;

      // Keep guest orders distinct when there is no email to consolidate.
      const consolidated: Record<
        string,
        FailedOrder & { attempt_count: number }
      > = {};

      const rows = (data ?? []) as FailedOrderRow[];
      rows.slice(0, FOLLOW_UP_QUERY_LIMIT).forEach((order) => {
        // Orders still marked Oxygen share the independent RPC budget.
        if (order.payment_method === 'oxygen') return;
        const email = order.customer_email?.trim() ?? '';
        const key = email
          ? `email:${email.toLowerCase()}`
          : `order:${order.id}`;
        if (!consolidated[key]) {
          consolidated[key] = {
            id: order.id,
            order_number: order.order_number,
            customer_id: order.customer_id,
            customer_name: order.customer_name,
            customer_email: email,
            customer_phone: order.customer_phone,
            total: order.total,
            payment_status: toPaymentStatus(order.payment_status),
            payment_method: order.payment_method,
            created_at: order.created_at,
            gateway_response: order.transactions?.[0]?.gateway_response,
            gateway: order.transactions?.[0]?.gateway,
            attempt_count: 1,
          };
        } else {
          // Track attempt count but keep most recent order's total (data is already ordered DESC)
          consolidated[key].attempt_count += 1;
        }
      });

      return {
        orders: Object.values(consolidated),
        isLimited: rows.length > FOLLOW_UP_QUERY_LIMIT,
      };
    },
    enabled: !!merchantId,
    staleTime: 1000 * 60 * 2, // 2 minutes
    refetchOnWindowFocus: false,
  });
  return {
    ...query,
    data: query.data?.orders,
    isLimited: query.data?.isLimited ?? false,
  };
}
