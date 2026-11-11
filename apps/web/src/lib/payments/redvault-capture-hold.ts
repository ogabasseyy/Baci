import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { redvaultOrderPaymentMethodRowsSchema } from '@/schemas/redvault-order-payment-method';

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
  merchantId,
  orderId,
  reference,
  rpcClient,
  transactionId,
}: {
  gateway: 'juicyway' | 'korapay' | 'paystack';
  gatewayResponse: Record<string, unknown>;
  merchantId: string;
  orderId: string;
  reference: string;
  rpcClient: RedvaultCaptureHoldRpcClient;
  transactionId: string;
}): Promise<RedvaultCaptureHoldOutcome> {
  // Classification runs through the merchant-bound scoped client, never
  // the route's service-role client: this module sits in user-facing
  // verification call graphs, and the narrow RPC discloses only the
  // payment method while enforcing the merchant binding.
  const { data: classification, error: classificationError } =
    await rpcClient.rpc('get_redvault_order_payment_method', {
      p_merchant_id: merchantId,
      p_order_id: orderId,
    });
  if (classificationError) {
    throw classificationError;
  }

  const classificationRows =
    redvaultOrderPaymentMethodRowsSchema.safeParse(classification);
  if (!classificationRows.success) {
    throw new Error('redvault_capture_hold_classification_invalid');
  }
  const classifiedRow = classificationRows.data[0];

  // A missing row means the order is absent or bound to another merchant:
  // fail closed. A present row with no payment method is an order that was
  // never routed through REDVAULT (for example a staff-created in-store
  // invoice later paid by bank transfer), so it is simply not REDVAULT.
  if (!classifiedRow) {
    throw new Error('redvault_capture_hold_order_not_found');
  }

  if (classifiedRow.payment_method !== 'uba_redvault') {
    return { kind: 'not_redvault' };
  }

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
