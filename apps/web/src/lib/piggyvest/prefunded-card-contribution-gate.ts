import 'server-only';
import { prefundedCardContributionSchemas as schemas } from '@/schemas/prefunded-card-contribution';

type Decision = {
  status:
    | 'input_invalid'
    | 'preflight_rejected'
    | 'collection_pending'
    | 'collection_failed'
    | 'collection_reconciliation_required'
    | 'dispatch_blocked'
    | 'transfer_dispatch_required'
    | 'funding_pending'
    | 'reconciliation_required'
    | 'ready_for_projection'
    | 'projection_confirmed';
  collection: string;
  transfer: string;
  completion: string;
  refund:
    | 'not_authorized'
    | 'prohibited_until_transfer_final'
    | 'explicit_operator_decision_required';
  reason: string;
};

function decision(
  status: Decision['status'],
  input: {
    collection: { status: string };
    transfer: { status: string };
    completion: { status: string };
  },
  refund: Decision['refund'],
  reason: string
): Decision {
  return {
    status,
    collection: input.collection.status,
    transfer: input.transfer.status,
    completion: input.completion.status,
    refund,
    reason,
  };
}

export function evaluatePrefundedCardContribution(input: unknown): Decision {
  const parsed = schemas.input.safeParse(input);
  if (!parsed.success)
    return {
      status: 'input_invalid',
      collection: 'unavailable',
      transfer: 'unavailable',
      completion: 'unavailable',
      refund: 'not_authorized',
      reason: 'immutable_operation_or_preflight_invalid',
    };

  const value = parsed.data;
  if (
    value.preflight.status !== 'reserved' &&
    (value.collection.status === 'verified_success' ||
      value.collection.status === 'unknown' ||
      value.collection.status === 'reversed')
  )
    return decision(
      'reconciliation_required',
      value,
      'not_authorized',
      'collected_but_reservation_unavailable'
    );
  if (value.preflight.status !== 'reserved')
    return decision(
      'preflight_rejected',
      value,
      'not_authorized',
      `preflight_${value.preflight.status}`
    );

  if (value.collection.status !== 'verified_success') {
    if (value.collection.status === 'verified_failed')
      return decision(
        'collection_failed',
        value,
        'not_authorized',
        'collection_verified_failed'
      );
    if (
      value.collection.status === 'unknown' ||
      value.collection.status === 'reversed'
    )
      return decision(
        'collection_reconciliation_required',
        value,
        'not_authorized',
        `collection_${value.collection.status}`
      );
    return decision(
      'collection_pending',
      value,
      'not_authorized',
      `collection_${value.collection.status}`
    );
  }

  if (
    value.collection.reference !== value.operation.collectionReference ||
    value.collection.amountKobo !== value.operation.amountKobo ||
    value.collection.currency !== value.operation.currency ||
    value.collection.savedMethodId !== value.operation.savedMethodId
  )
    return decision(
      'collection_reconciliation_required',
      value,
      'not_authorized',
      'collection_evidence_mismatch'
    );

  if (value.transferContract === 'unverified')
    return decision(
      'dispatch_blocked',
      value,
      'not_authorized',
      'provider_transfer_contract_unverified'
    );

  if (value.transfer.status === 'not_started')
    return decision(
      'transfer_dispatch_required',
      value,
      'not_authorized',
      'restricted_worker_must_dispatch_once'
    );
  if (
    value.transfer.status === 'dispatching' ||
    value.transfer.status === 'pending'
  )
    return decision(
      'funding_pending',
      value,
      'not_authorized',
      'provider_transfer_pending'
    );
  if (value.transfer.status === 'unknown')
    return decision(
      'reconciliation_required',
      value,
      'prohibited_until_transfer_final',
      'provider_transfer_unknown'
    );
  if (value.transfer.status === 'verified_failed')
    return decision(
      'reconciliation_required',
      value,
      'explicit_operator_decision_required',
      'provider_transfer_failed'
    );

  if (value.transfer.status !== 'verified_success')
    return decision(
      'reconciliation_required',
      value,
      'prohibited_until_transfer_final',
      'provider_transfer_unresolved'
    );

  if (
    value.transfer.reference !== value.operation.transferReference ||
    value.transfer.amountKobo !== value.operation.amountKobo ||
    value.transfer.currency !== value.operation.currency ||
    value.transfer.sourceWalletId !== value.operation.sourceWalletId ||
    value.transfer.destinationWalletId !== value.operation.destinationWalletId
  )
    return decision(
      'reconciliation_required',
      value,
      'prohibited_until_transfer_final',
      'transfer_evidence_mismatch'
    );

  if (value.completion.status === 'unclaimed')
    return decision(
      'ready_for_projection',
      value,
      'not_authorized',
      'trusted_canonical_projection_required'
    );

  if (
    value.completion.operationId !== value.operation.operationId ||
    value.completion.integrationId !== value.operation.integrationId ||
    value.completion.merchantId !== value.operation.merchantId ||
    value.completion.customerId !== value.operation.customerId ||
    value.completion.goalId !== value.operation.goalId ||
    value.completion.treasuryBindingId !== value.operation.treasuryBindingId ||
    value.completion.requestFingerprint !==
      value.operation.requestFingerprint ||
    value.completion.providerTransactionId !==
      value.transfer.providerTransactionId ||
    value.completion.amountKobo !== value.operation.amountKobo ||
    value.completion.currency !== value.operation.currency
  )
    return decision(
      'reconciliation_required',
      value,
      'prohibited_until_transfer_final',
      'canonical_projection_snapshot_mismatch'
    );

  return decision(
    'projection_confirmed',
    value,
    'not_authorized',
    'trusted_canonical_projection_confirmed'
  );
}
