import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import {
  oxygenFollowUpCandidateSchema,
  oxygenFollowUpMerchantSchema,
  oxygenFollowUpOrderSchema,
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
const MAX_OXYGEN_FOLLOW_UP_CANDIDATES = 250;
const ORDER_LOOKUP_BATCH_SIZE = 50;

function extractBoundedArray(
  payload: unknown,
  maxItems: number
): { items: unknown[]; isBoundedValid: boolean } {
  const parsed = z.array(z.unknown()).max(maxItems).safeParse(payload);
  if (parsed.success) {
    return { items: parsed.data, isBoundedValid: true };
  }
  return {
    items: Array.isArray(payload) ? payload.slice(0, maxItems) : [],
    isBoundedValid: false,
  };
}

/** The RPC returns categories only; order/contact data still goes through orders RLS. */
export async function fetchOxygenFollowUps(
  merchantId: string
): Promise<{ orders: FailedOrder[]; isIncomplete: boolean }> {
  const validatedMerchantId = oxygenFollowUpMerchantSchema.parse(merchantId);
  const { data, error } = await supabase.rpc('oxygen_follow_up_candidates', {
    p_merchant_id: validatedMerchantId,
  });
  if (error) throw new Error('Could not load Oxygen follow-ups');
  const candidatePayload = extractBoundedArray(
    data,
    MAX_OXYGEN_FOLLOW_UP_CANDIDATES
  );
  const candidates = candidatePayload.items.flatMap((row) => {
    const parsed = oxygenFollowUpCandidateSchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
  let isIncomplete =
    !candidatePayload.isBoundedValid ||
    candidates.length !== candidatePayload.items.length;
  if (candidates.length === 0) return { orders: [], isIncomplete };

  const ids = candidates.map((candidate) => candidate.order_id);
  const batches: string[][] = [];
  for (let offset = 0; offset < ids.length; offset += ORDER_LOOKUP_BATCH_SIZE) {
    batches.push(ids.slice(offset, offset + ORDER_LOOKUP_BATCH_SIZE));
  }
  const results = await Promise.allSettled(
    batches.map((batch) =>
      supabase
        .from('orders')
        .select(
          'id,order_number,customer_id,customer_name,customer_email,customer_phone,total,payment_status,payment_method,created_at,cancelled_at'
        )
        .eq('merchant_id', validatedMerchantId)
        .in('id', batch)
    )
  );
  if (
    results.every(
      (result) => result.status === 'rejected' || result.value.error
    )
  ) {
    throw new Error('Could not load Oxygen follow-up orders');
  }
  const orders = results.flatMap((result) => {
    if (result.status === 'rejected' || result.value.error) {
      isIncomplete = true;
      return [];
    }
    const batchPayload = extractBoundedArray(
      result.value.data,
      ORDER_LOOKUP_BATCH_SIZE
    );
    if (!batchPayload.isBoundedValid) isIncomplete = true;
    return batchPayload.items.flatMap((row) => {
      const parsed = oxygenFollowUpOrderSchema.safeParse(row);
      if (!parsed.success) isIncomplete = true;
      return parsed.success ? [parsed.data] : [];
    });
  });
  const byId = new Map(orders.map((order) => [order.id, order]));
  const followUps = candidates.flatMap((candidate) => {
    const order = byId.get(candidate.order_id);
    if (!order) return [];
    const paymentStatus = PAYMENT_STATUSES.has(
      order.payment_status as FailedOrder['payment_status']
    )
      ? (order.payment_status as FailedOrder['payment_status'])
      : 'unknown';
    const amount =
      order.total === null ||
      (typeof order.total === 'string' && !order.total.trim())
        ? null
        : Number(order.total);
    const total = amount !== null && Number.isFinite(amount) ? amount : null;
    return [
      {
        ...order,
        order_number: order.order_number ?? '',
        customer_name: order.customer_name ?? '',
        customer_email: order.customer_email ?? '',
        customer_phone: order.customer_phone ?? '',
        payment_method: order.payment_method ?? '',
        payment_status: paymentStatus,
        total,
        attempt_count: 1,
        follow_up_at: candidate.last_activity_at,
        oxygen_follow_up_status:
          total === null ||
          order.cancelled_at !== null ||
          TERMINAL_OR_UNKNOWN.has(paymentStatus) ||
          (paymentStatus === 'bnpl_approved' &&
            candidate.follow_up_status !== 'approved_pending') ||
          order.payment_method !== 'oxygen'
            ? ('needs_review' as const)
            : candidate.follow_up_status,
      },
    ];
  });
  return { orders: followUps, isIncomplete };
}

export function useOxygenFollowUps() {
  const { merchant } = useMerchant();
  const query = useQuery({
    queryKey: ['oxygen-follow-ups', merchant?.id],
    queryFn: () => {
      if (!merchant?.id) throw new Error('Merchant ID is required');
      return fetchOxygenFollowUps(merchant.id);
    },
    enabled: Boolean(merchant?.id),
    staleTime: 1000 * 60 * 2,
    refetchOnWindowFocus: false,
  });
  return {
    ...query,
    data: query.data?.orders,
    isIncomplete: query.data?.isIncomplete ?? false,
  };
}
