import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
  oxygenFollowUpCandidatesSchema,
  oxygenFollowUpMerchantSchema,
  oxygenFollowUpOrdersSchema,
} from '@/schemas/oxygen-follow-up';
import type { FailedOrder } from './useFailedOrders';
import { useMerchant } from './useMerchant';

const PAYMENT_STATUSES = new Set<FailedOrder['payment_status']>([
  'bnpl_pending',
  'bnpl_approved',
  'failed',
  'pending',
  'expired',
  'unpaid',
  'paid',
  'refunded',
  'cancelled',
  'unknown',
]);
const TERMINAL_OR_UNKNOWN = new Set([
  'paid',
  'refunded',
  'cancelled',
  'unknown',
]);
const ORDER_LOOKUP_BATCH_SIZE = 50;

/** The RPC returns categories only; order/contact data still goes through orders RLS. */
export async function fetchOxygenFollowUps(
  merchantId: string
): Promise<FailedOrder[]> {
  const validatedMerchantId = oxygenFollowUpMerchantSchema.parse(merchantId);
  const { data, error } = await supabase.rpc('oxygen_follow_up_candidates', {
    p_merchant_id: validatedMerchantId,
  });
  if (error) throw new Error('Could not load Oxygen follow-ups');
  const candidates = oxygenFollowUpCandidatesSchema.parse(data);
  if (candidates.length === 0) return [];

  const ids = candidates.map((candidate) => candidate.order_id);
  const batches: string[][] = [];
  for (let offset = 0; offset < ids.length; offset += ORDER_LOOKUP_BATCH_SIZE) {
    batches.push(ids.slice(offset, offset + ORDER_LOOKUP_BATCH_SIZE));
  }
  const results = await Promise.all(
    batches.map((batch) =>
      supabase
        .from('orders')
        .select(
          'id,order_number,customer_id,customer_name,customer_email,customer_phone,total,payment_status,payment_method,created_at'
        )
        .eq('merchant_id', validatedMerchantId)
        .in('id', batch)
    )
  );
  const orders = results.flatMap((result) => {
    if (result.error) throw new Error('Could not load Oxygen follow-up orders');
    return oxygenFollowUpOrdersSchema.parse(result.data);
  });
  const byId = new Map(orders.map((order) => [order.id, order]));
  return candidates.flatMap((candidate) => {
    const order = byId.get(candidate.order_id);
    if (!order) return [];
    const paymentStatus = PAYMENT_STATUSES.has(
      order.payment_status as FailedOrder['payment_status']
    )
      ? (order.payment_status as FailedOrder['payment_status'])
      : 'unknown';
    const total = Number(order.total ?? 0);
    return [
      {
        ...order,
        order_number: order.order_number ?? '',
        customer_name: order.customer_name ?? '',
        customer_email: order.customer_email ?? '',
        customer_phone: order.customer_phone ?? '',
        payment_method: order.payment_method ?? '',
        payment_status: paymentStatus,
        total: Number.isFinite(total) ? total : 0,
        attempt_count: 1,
        follow_up_at: candidate.last_activity_at,
        oxygen_follow_up_status:
          TERMINAL_OR_UNKNOWN.has(paymentStatus) ||
          (paymentStatus === 'bnpl_approved' &&
            candidate.follow_up_status !== 'approved_pending') ||
          order.payment_method !== 'oxygen'
            ? ('needs_review' as const)
            : candidate.follow_up_status,
      },
    ];
  });
}

export function useOxygenFollowUps() {
  const { merchant } = useMerchant();
  return useQuery({
    queryKey: ['oxygen-follow-ups', merchant?.id],
    queryFn: () => {
      if (!merchant?.id) throw new Error('Merchant ID is required');
      return fetchOxygenFollowUps(merchant.id);
    },
    enabled: Boolean(merchant?.id),
    staleTime: 1000 * 60 * 2,
    refetchOnWindowFocus: false,
  });
}
