import 'server-only';

import { getImeiFxNgnUsd } from '@/env';
import { decryptImeiIdentifier } from '@/lib/imei-identifier-crypto';
import type { createPetrockClient } from '@/lib/imei-providers/petrock/petrock-client';
import type { createAdminClient } from '@/lib/supabase/admin';
import { placePetrockRemediationOrder } from './petrock-remediation-order-flow';
import {
  createPetrockRemediationOrderState,
  loadPetrockRemediationOrderContext,
} from './petrock-remediation-order-state';
import type { ClaimedPetrockRemediationOrder } from './petrock-remediation-reconcile-state';

export async function recoverPaidPetrockRemediationOrder({
  client,
  encryptionKey,
  order,
  origin,
  supabaseAdmin,
}: {
  client: ReturnType<typeof createPetrockClient>;
  encryptionKey: string;
  order: ClaimedPetrockRemediationOrder;
  origin: string;
  supabaseAdmin: ReturnType<typeof createAdminClient>;
}) {
  if (order.provider_order_id || order.provider_attempt_started_at)
    return { kind: 'already_started' as const };
  const fxRate = getImeiFxNgnUsd();
  const state = createPetrockRemediationOrderState({
    customerId: order.customer_id,
    fxRate: fxRate ?? 0,
    merchantId: order.merchant_id,
    supabaseAdmin,
  });
  async function failRecovery(reason: string) {
    const refunded = await state.failBeforeAcceptance({
      customerMessage:
        'This unlock could not be submitted, so your wallet was refunded.',
      orderId: order.id,
      reason,
    });
    return {
      kind: refunded ? ('failed' as const) : ('already_started' as const),
    };
  }
  if (typeof fxRate !== 'number' || !Number.isFinite(fxRate) || fxRate <= 0) {
    return failRecovery('paid_recovery_fx_unavailable');
  }
  if (
    !order.identifier_ciphertext ||
    !order.payment_currency ||
    !order.remediation_product_id
  ) {
    return failRecovery('paid_recovery_context_missing');
  }

  const context = await loadPetrockRemediationOrderContext({
    customerId: order.customer_id,
    merchantId: order.merchant_id,
    orderId: order.id,
    productId: order.remediation_product_id,
    supabaseAdmin,
  });
  if (!context) {
    return failRecovery('paid_recovery_context_missing');
  }

  if (
    context.order.status !== 'paid' ||
    context.order.providerOrderId ||
    context.order.providerAttemptStartedAt
  )
    return { kind: 'already_started' as const };

  let identifier: string;
  try {
    identifier = decryptImeiIdentifier(
      context.identifierCiphertext,
      encryptionKey
    );
  } catch {
    return failRecovery('paid_recovery_identifier_unavailable');
  }

  const result = await placePetrockRemediationOrder({
    client,
    fxRate,
    identifier,
    order: { ...context.order, status: 'paid' },
    origin,
    paymentCurrency: order.payment_currency,
    product: context.product,
    state,
  });
  if (result.kind === 'eligibility_failed')
    return failRecovery('eligibility_evidence_invalid');
  return result;
}
