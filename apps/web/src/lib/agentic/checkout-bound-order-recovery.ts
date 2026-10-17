import { buildPaymentPendingSessionUpdate } from '@/lib/agentic/checkout-completion-payloads';
import {
  compensateCreatedOrderAfterFinalizationFailure,
  releaseFinalizationClaimSafely,
} from '@/lib/agentic/checkout-finalization-compensation';
import type { FinalizeAgenticCheckoutInput } from './checkout-completion-finalize.types';

type RecoveryInput = Parameters<
  typeof compensateCreatedOrderAfterFinalizationFailure
>[0];

/** Bound creation commits the receipt and cart together; only retry the session. */
export function recoverFinalizationOrderWriteFailure(
  input: RecoveryInput & { sharedCartBound: boolean }
) {
  return input.sharedCartBound
    ? releaseFinalizationClaimSafely(input)
    : compensateCreatedOrderAfterFinalizationFailure(input);
}

export async function verifyBoundFinalizationOrder(
  input: Omit<RecoveryInput, 'orderError'>
): Promise<
  { ok: true; paid: boolean } | { ok: false; error: string; status: 409 | 500 }
> {
  const { data: order, error } = await input.supabase
    .from('orders')
    .select('payment_status, shipping_status')
    .eq('id', input.orderId)
    .eq('merchant_id', input.merchantId)
    .maybeSingle();
  const failure =
    error || !order
      ? { error: 'Could not verify order', status: 500 as const }
      : (order.payment_status !== 'paid' &&
            !['pending', 'unpaid'].includes(order.payment_status)) ||
          order.shipping_status === 'cancelled'
        ? { error: 'Order is no longer awaiting payment', status: 409 as const }
        : null;
  if (failure) {
    // Even terminal order conflicts release the session claim so retries can
    // re-read the authoritative receipt instead of remaining stuck finalizing.
    await releaseFinalizationClaimSafely({
      ...input,
      orderError: error ?? failure.error,
    });
    return { ok: false, ...failure };
  }
  return { ok: true, paid: order?.payment_status === 'paid' };
}

export function buildAlreadyPaidFinalizationResponse(
  sessionId: string,
  orderId: string
) {
  return {
    id: sessionId,
    status: 'completed',
    order_id: orderId,
    order: { id: orderId, status: 'paid' },
  };
}

export function writeFinalizedOrderSession({
  buyer,
  dvaAccount,
  metadata,
  orderId,
  orderAlreadyPaid,
  supabase,
  sessionId,
  merchantId,
  finalizationClaim,
}: Pick<
  FinalizeAgenticCheckoutInput,
  'buyer' | 'dvaAccount' | 'metadata' | 'supabase' | 'sessionId' | 'merchantId'
> & { orderId: string; orderAlreadyPaid: boolean; finalizationClaim: string }) {
  const updatePayload = buildPaymentPendingSessionUpdate({
    buyer,
    dvaAccount,
    metadata,
    orderId,
  });
  if (orderAlreadyPaid) {
    updatePayload.status = 'completed';
    updatePayload.metadata.agentic.payment_state = 'paid';
  }
  return supabase
    .from('checkout_sessions')
    .update(updatePayload)
    .eq('session_id', sessionId)
    .eq('merchant_id', merchantId)
    .eq('payment_reference', dvaAccount.account_number)
    .is('order_id', null)
    .in('status', ['pending', 'processing'])
    .contains('metadata', {
      agentic: {
        finalization_claim: finalizationClaim,
        payment_state: 'order_finalizing',
      },
    })
    .select('session_id')
    .maybeSingle();
}

export function readFinalizationOrderId(
  metadata: FinalizeAgenticCheckoutInput['metadata']
) {
  const id = metadata.agentic?.finalization_order_id;
  return typeof id === 'string' && id.trim().length > 0 ? id.trim() : null;
}

/**
 * Side-effect-free order-state read used to revalidate the order
 * after the session write and before the order-created webhook: a
 * payment (or cancellation) landing between the pre-write
 * verification and the session write must not be answered with
 * fresh payment instructions and a duplicate webhook.
 */
export async function readFinalizationOrderState(input: {
  merchantId: string;
  orderId: string;
  supabase: FinalizeAgenticCheckoutInput['supabase'];
}): Promise<'paid' | 'conflict' | 'pending' | 'error'> {
  let data: { payment_status?: unknown; shipping_status?: unknown } | null;
  try {
    const result = await input.supabase
      .from('orders')
      .select('payment_status, shipping_status')
      .eq('merchant_id', input.merchantId)
      .eq('id', input.orderId)
      .maybeSingle();
    if (result.error) return 'error';
    data = result.data;
  } catch {
    return 'error';
  }
  if (!data) return 'error';
  if (data.payment_status === 'paid') return 'paid';
  if (data.shipping_status === 'cancelled') return 'conflict';
  if (!['pending', 'unpaid'].includes(data.payment_status as string))
    return 'conflict';
  return 'pending';
}

/**
 * Rewrites a just-written payment_pending session as completed once
 * the post-write recheck finds the order already paid. Fenced by the
 * order id and the pending payment state the write installed; when
 * the payment webhook already completed the session, zero rows match
 * and the already-paid answer below is still correct.
 */
export function writePaidFinalizationSession(
  input: Pick<
    FinalizeAgenticCheckoutInput,
    | 'buyer'
    | 'dvaAccount'
    | 'metadata'
    | 'supabase'
    | 'sessionId'
    | 'merchantId'
  > & { orderId: string }
) {
  const payload = buildPaymentPendingSessionUpdate(input);
  return input.supabase
    .from('checkout_sessions')
    .update({
      ...payload,
      status: 'completed',
      metadata: {
        ...payload.metadata,
        agentic: {
          ...(payload.metadata.agentic ?? {}),
          payment_state: 'paid',
        },
      },
    })
    .eq('session_id', input.sessionId)
    .eq('merchant_id', input.merchantId)
    .eq('order_id', input.orderId)
    .contains('metadata', {
      agentic: { payment_state: 'payment_pending' },
    })
    .select('session_id')
    .maybeSingle();
}

/**
 * Reconciles a just-written payment_pending session after the order
 * was cancelled in the verify/write window: without this, a later
 * completion would serve the stored bank-transfer instructions for a
 * cancelled order. Marks the payment setup failed (a retryable
 * terminal for this order) under the same pending-state fence the
 * session write installed.
 */
export function writeCancelledFinalizationSession(
  input: Pick<
    FinalizeAgenticCheckoutInput,
    'metadata' | 'supabase' | 'sessionId' | 'merchantId'
  > & { orderId: string }
) {
  return input.supabase
    .from('checkout_sessions')
    .update({
      metadata: {
        ...input.metadata,
        agentic: {
          ...(input.metadata.agentic ?? {}),
          payment_state: 'payment_setup_failed',
        },
      },
    })
    .eq('session_id', input.sessionId)
    .eq('merchant_id', input.merchantId)
    .eq('order_id', input.orderId)
    .contains('metadata', {
      agentic: { payment_state: 'payment_pending' },
    })
    .select('session_id')
    .maybeSingle();
}
