import 'server-only';

import type { createPetrockClient } from '@/lib/imei-providers/petrock/petrock-client';
import { parsePetrockReplay } from '@/lib/imei-providers/petrock/petrock-parser';
import { parsePetrockModelScope } from './petrock-device-model';
import { submitNextPetrockEligibilityCheck } from './petrock-eligibility-engine';
import { evaluatePetrockRemediationEligibility } from './petrock-remediation-eligibility';
import { normalizePetrockRemediationCarrier } from './petrock-remediation-product-parser';
import type {
  ClaimedPetrockRemediationOrder,
  createPetrockRemediationReconcileState,
} from './petrock-remediation-reconcile-state';

type PetrockClient = ReturnType<typeof createPetrockClient>;
type ReconcileState = ReturnType<typeof createPetrockRemediationReconcileState>;
type StartNext = typeof submitNextPetrockEligibilityCheck;

function pollDelay(attempt: number) {
  if (attempt <= 3) return 30_000;
  if (attempt <= 12) return 5 * 60_000;
  return 60 * 60_000;
}

function stringEvidence(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === 'string' &&
        entry[1].trim().length > 0 &&
        !/^(unknown|unknown device)$/i.test(entry[1].trim())
    )
  );
}

async function resolveEligibility({
  evidence,
  loadProducts,
  order,
  state,
}: {
  evidence: Record<string, string | undefined>;
  loadProducts: () => Promise<
    Array<{
      carrier: string;
      id: string;
      manual_disabled: boolean;
      model_scope: unknown;
      status_segment: string;
    }>
  >;
  order: ClaimedPetrockRemediationOrder;
  state: ReconcileState;
}) {
  const rows = await loadProducts();
  const products = rows.flatMap((row) => {
    const modelScope = parsePetrockModelScope(row.model_scope);
    return modelScope
      ? [
          {
            carrier: row.carrier,
            id: row.id,
            isActive: true,
            manualDisabled: row.manual_disabled,
            modelScope,
            statusSegment: row.status_segment,
          },
        ]
      : [];
  });
  const evaluation = evaluatePetrockRemediationEligibility({
    products,
    result: evidence,
  });
  if (evaluation.kind === 'eligible') {
    const matched = rows.find((row) => row.id === evaluation.productIds[0]);
    await state.resolveEligibility({
      carrier:
        normalizePetrockRemediationCarrier(evidence.carrier ?? '') ?? undefined,
      customerMessage: 'A verified clean carrier-unlock service is available.',
      deviceModel: evidence.device,
      orderId: order.id,
      status: 'eligible',
      statusSegment: matched?.status_segment,
    });
    return { kind: 'eligible' as const };
  }
  await state.resolveEligibility({
    customerMessage: 'No verified carrier-unlock service is available.',
    failureReason:
      evaluation.kind === 'suppressed'
        ? evaluation.reason
        : 'eligibility_incomplete',
    orderId: order.id,
    status: 'suppressed',
  });
  return { kind: 'suppressed' as const };
}

export async function reconcilePetrockRemediationOrder({
  client,
  decryptIdentifier,
  loadProducts,
  order,
  origin,
  readProduct,
  recoverPaidOrder,
  startNext = submitNextPetrockEligibilityCheck,
  state,
}: {
  client: Pick<PetrockClient, 'getOrder'> &
    Partial<Pick<PetrockClient, 'getAccount' | 'submitOrder'>>;
  decryptIdentifier: (ciphertext: string) => string;
  loadProducts: () => Promise<
    Array<{
      carrier: string;
      id: string;
      manual_disabled: boolean;
      model_scope: unknown;
      status_segment: string;
    }>
  >;
  order: ClaimedPetrockRemediationOrder;
  origin: string;
  readProduct: Parameters<StartNext>[0]['readProduct'];
  recoverPaidOrder?: (order: ClaimedPetrockRemediationOrder) => Promise<{
    kind:
      | 'already_started'
      | 'failed'
      | 'pending'
      | 'preflight_failed'
      | 'submission_unknown';
  }>;
  startNext?: StartNext;
  state: ReconcileState;
}) {
  if (order.status === 'paid' && recoverPaidOrder) {
    const recovered = await recoverPaidOrder(order);
    if (recovered.kind === 'submission_unknown') {
      return { kind: 'submission_unknown' as const };
    }
    if (recovered.kind === 'failed' || recovered.kind === 'preflight_failed') {
      return { kind: 'failed' as const };
    }
    return { kind: 'pending' as const };
  }
  if (!order.provider_order_id) {
    if (
      order.status === 'submission_unknown' &&
      (order.eligibility_next_check || !order.payment_currency)
    ) {
      await state.suppress({
        message: 'We could not verify a safe unlock option. Please try again.',
        orderId: order.id,
        reason: 'eligibility_submission_unresolved',
      });
      return { kind: 'suppressed' as const };
    }
    if (order.status === 'submission_unknown') {
      await state.failBeforeAcceptance({
        customerMessage:
          'This unlock submission could not be confirmed, so your wallet was refunded.',
        orderId: order.id,
        reason: 'provider_submission_unresolved',
      });
      return { kind: 'failed' as const };
    }
    await state.markSubmissionUnknown({
      orderId: order.id,
      reason: 'stale_submission_without_provider_order',
    });
    return { kind: 'submission_unknown' as const };
  }

  const provider = await client.getOrder(order.provider_order_id);
  if (!provider.ok) {
    await state.reschedule({
      leaseToken: order.reconcile_lease_token,
      nextPollAt: new Date(
        Date.now() + pollDelay(order.reconcile_attempts)
      ).toISOString(),
      orderId: order.id,
      providerStatus: `poll_${provider.kind}`,
    });
    return { kind: 'pending' as const };
  }
  const providerOrder = provider.data;
  if (providerOrder.status === 'new' || providerOrder.status === 'in-process') {
    await state.reschedule({
      leaseToken: order.reconcile_lease_token,
      nextPollAt: new Date(
        Date.now() + pollDelay(order.reconcile_attempts)
      ).toISOString(),
      orderId: order.id,
      providerStatus: providerOrder.status,
    });
    return { kind: 'pending' as const };
  }

  if (
    order.status === 'eligibility_pending' ||
    (order.status === 'submission_unknown' && order.eligibility_next_check)
  ) {
    if (providerOrder.status === 'reject' || !order.eligibility_next_check) {
      await state.resolveEligibility({
        customerMessage: 'We could not verify a safe unlock option.',
        failureReason: 'house_check_rejected',
        orderId: order.id,
        status: 'suppressed',
      });
      return { kind: 'suppressed' as const };
    }

    const patch = stringEvidence(parsePetrockReplay(providerOrder.replay));
    const evidence = { ...order.eligibility_evidence, ...patch };
    await state.advanceEvidence({
      check: order.eligibility_next_check,
      evidence: patch,
      orderId: order.id,
      providerStatus: providerOrder.status,
    });
    if (
      !order.identifier_ciphertext ||
      !client.getAccount ||
      !client.submitOrder
    ) {
      await state.markSubmissionUnknown({
        orderId: order.id,
        reason: 'eligibility_identity_or_client_missing',
      });
      return { kind: 'submission_unknown' as const };
    }
    const next = await startNext({
      client: {
        getAccount: client.getAccount,
        submitOrder: client.submitOrder,
      },
      identifier: decryptIdentifier(order.identifier_ciphertext),
      order: {
        eligibilityChecksCompleted: [
          ...order.eligibility_checks_completed,
          order.eligibility_next_check,
        ],
        eligibilityEvidence: evidence,
        id: order.id,
      },
      origin,
      readProduct,
      state,
    });
    if (next.kind === 'ready') {
      await resolveEligibility({ evidence, loadProducts, order, state });
    }
    return { kind: 'eligibility_advanced' as const };
  }

  await state.finalize({
    customerMessage:
      providerOrder.status === 'success'
        ? 'Your carrier unlock is complete.'
        : 'The carrier could not complete this unlock.',
    failureReason:
      providerOrder.status === 'success' ? undefined : 'provider_rejected',
    orderId: order.id,
    providerStatus: providerOrder.status,
    success: providerOrder.status === 'success',
  });
  return {
    kind:
      providerOrder.status === 'success'
        ? ('completed' as const)
        : ('failed' as const),
  };
}
