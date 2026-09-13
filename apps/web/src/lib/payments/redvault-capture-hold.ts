import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

const captureHoldOutcomeSchema = z.object({
  duplicate: z.boolean(),
  kind: z.literal('captured_held'),
  reason: z.string().min(1),
});

const captureEvidenceReviewOutcomeSchema = z.object({
  duplicate: z.boolean(),
  kind: z.literal('capture_evidence_review'),
  reason: z.string().min(1),
});

type RedvaultCaptureHoldRpcClient = Pick<SupabaseClient, 'rpc'>;

export type RedvaultCaptureHoldOutcome =
  | { kind: 'not_redvault' }
  | { duplicate: boolean; kind: 'captured_held'; reason: string }
  | { duplicate: boolean; kind: 'capture_evidence_review'; reason: string };

export async function captureOrHoldRedvaultPayment({
  gateway,
  gatewayResponse,
  orderId,
  reference,
  supabase,
  transactionId,
}: {
  gateway: 'juicyway' | 'korapay' | 'paystack';
  gatewayResponse: Record<string, unknown>;
  orderId: string;
  reference: string;
  supabase: SupabaseClient;
  transactionId: string;
}): Promise<RedvaultCaptureHoldOutcome> {
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('payment_method')
    .eq('id', orderId)
    .maybeSingle();

  if (orderError || !order) {
    throw orderError ?? new Error('redvault_capture_hold_order_not_found');
  }

  if (order.payment_method !== 'uba_redvault') {
    return { kind: 'not_redvault' };
  }

  const rpcClient = supabase as unknown as RedvaultCaptureHoldRpcClient;
  const { data, error } = await rpcClient.rpc(
    'capture_or_hold_uba_redvault_payment',
    {
      p_gateway: gateway,
      p_gateway_response: gatewayResponse,
      p_order_id: orderId,
      p_reference: reference,
      p_transaction_id: transactionId,
    }
  );

  if (error) {
    throw error;
  }

  const held = captureHoldOutcomeSchema.safeParse(data);
  if (held.success) {
    return held.data;
  }

  const review = captureEvidenceReviewOutcomeSchema.safeParse(data);
  if (review.success) {
    return review.data;
  }

  throw new Error('redvault_capture_hold_rpc_invalid_response');
}
