import { expect, it } from 'vitest';
import { evaluatePrefundedCardContribution } from './prefunded-card-contribution-gate';

const operation = {
  operationId: '10000000-0000-4000-8000-000000000001',
  integrationId: '20000000-0000-4000-8000-000000000002',
  merchantId: '30000000-0000-4000-8000-000000000003',
  customerId: '40000000-0000-4000-8000-000000000004',
  goalId: '50000000-0000-4000-8000-000000000005',
  treasuryBindingId: '60000000-0000-4000-8000-000000000006',
  savedMethodId: '70000000-0000-4000-8000-000000000007',
  amountKobo: 10_000,
  feeAllowanceKobo: 0,
  currency: 'NGN',
  requestFingerprint: 'synthetic-fingerprint-v1',
  collectionReference: 'synthetic-collection-ref',
  transferReference: 'synthetic-transfer-ref',
  sourceWalletId: 'synthetic-source-wallet',
  destinationWalletId: 'synthetic-destination-wallet',
};

const reservedPreflight = {
  status: 'reserved',
  reservationId: '80000000-0000-4000-8000-000000000008',
  operationId: operation.operationId,
  availableGoalCapacityKobo: 10_000,
  availableFloatKobo: 10_000,
  reservedTotalKobo: 10_000,
};

const verifiedCollection = {
  status: 'verified_success',
  reference: operation.collectionReference,
  amountKobo: operation.amountKobo,
  currency: operation.currency,
  savedMethodId: operation.savedMethodId,
};

it('does not authorize a provider transfer until the restricted adapter has verified the documented contract', () => {
  const result = evaluatePrefundedCardContribution({
    operation,
    preflight: reservedPreflight,
    collection: verifiedCollection,
    transfer: { status: 'not_started' },
    completion: { status: 'unclaimed' },
    transferContract: 'unverified',
  });

  expect(result).toEqual({
    status: 'dispatch_blocked',
    collection: 'verified_success',
    transfer: 'not_started',
    completion: 'unclaimed',
    refund: 'not_authorized',
    reason: 'provider_transfer_contract_unverified',
  });
});

it('requires the immutable collection reference, amount, currency, and saved method before funding', () => {
  const result = evaluatePrefundedCardContribution({
    operation,
    preflight: reservedPreflight,
    collection: { ...verifiedCollection, amountKobo: 9_999 },
    transfer: { status: 'not_started' },
    completion: { status: 'unclaimed' },
    transferContract: 'captured_and_reviewed',
  });

  expect(result).toEqual({
    status: 'collection_reconciliation_required',
    collection: 'verified_success',
    transfer: 'not_started',
    completion: 'unclaimed',
    refund: 'not_authorized',
    reason: 'collection_evidence_mismatch',
  });
});

it.each([
  'goal_capacity_insufficient',
  'float_insufficient',
] as const)('returns preflight_rejected before collection when atomic %s preflight fails', (status) => {
  expect(
    evaluatePrefundedCardContribution({
      operation,
      preflight: { status },
      collection: { status: 'not_started' },
      transfer: { status: 'not_started' },
      completion: { status: 'unclaimed' },
      transferContract: 'captured_and_reviewed',
    })
  ).toEqual({
    status: 'preflight_rejected',
    collection: 'not_started',
    transfer: 'not_started',
    completion: 'unclaimed',
    refund: 'not_authorized',
    reason: `preflight_${status}`,
  });
});

it.each([
  'verified_success',
  'unknown',
  'reversed',
] as const)('collected-but-reservation-unavailable enters reconciliation for %s collection evidence', (collectionStatus) => {
  const collection =
    collectionStatus === 'verified_success'
      ? verifiedCollection
      : { status: collectionStatus };
  expect(
    evaluatePrefundedCardContribution({
      operation,
      preflight: { status: 'float_insufficient' },
      collection,
      transfer: { status: 'not_started' },
      completion: { status: 'unclaimed' },
      transferContract: 'captured_and_reviewed',
    })
  ).toEqual({
    status: 'reconciliation_required',
    collection: collectionStatus,
    transfer: 'not_started',
    completion: 'unclaimed',
    refund: 'not_authorized',
    reason: 'collected_but_reservation_unavailable',
  });
});

it('distinguishes a verified failed collection from collection pending', () => {
  expect(
    evaluatePrefundedCardContribution({
      operation,
      preflight: reservedPreflight,
      collection: { status: 'verified_failed' },
      transfer: { status: 'not_started' },
      completion: { status: 'unclaimed' },
      transferContract: 'captured_and_reviewed',
    })
  ).toEqual({
    status: 'collection_failed',
    collection: 'verified_failed',
    transfer: 'not_started',
    completion: 'unclaimed',
    refund: 'not_authorized',
    reason: 'collection_verified_failed',
  });
});

it('rejects a non-zero fee allowance in the selected zero-fee staging model', () => {
  expect(
    evaluatePrefundedCardContribution({
      operation: { ...operation, feeAllowanceKobo: 1 },
      preflight: {
        ...reservedPreflight,
        availableFloatKobo: 10_001,
        reservedTotalKobo: 10_001,
      },
      collection: verifiedCollection,
      transfer: { status: 'not_started' },
      completion: { status: 'unclaimed' },
      transferContract: 'unverified',
    })
  ).toMatchObject({
    status: 'input_invalid',
    reason: 'immutable_operation_or_preflight_invalid',
  });
});

it.each([
  {
    transfer: { status: 'pending' },
    expected: {
      status: 'funding_pending',
      refund: 'not_authorized',
      reason: 'provider_transfer_pending',
    },
  },
  {
    transfer: { status: 'unknown' },
    expected: {
      status: 'reconciliation_required',
      refund: 'prohibited_until_transfer_final',
      reason: 'provider_transfer_unknown',
    },
  },
  {
    transfer: { status: 'verified_failed' },
    expected: {
      status: 'reconciliation_required',
      refund: 'explicit_operator_decision_required',
      reason: 'provider_transfer_failed',
    },
  },
])('keeps a verified collection non-complete while transfer is $transfer.status', ({
  transfer,
  expected,
}) => {
  expect(
    evaluatePrefundedCardContribution({
      operation,
      preflight: reservedPreflight,
      collection: verifiedCollection,
      transfer,
      completion: { status: 'unclaimed' },
      transferContract: 'captured_and_reviewed',
    })
  ).toEqual({
    ...expected,
    collection: 'verified_success',
    transfer: transfer.status,
    completion: 'unclaimed',
  });
});

it('requires a trusted canonical projection snapshot after exact terminal transfer correlation', () => {
  const transfer = {
    status: 'verified_success',
    reference: operation.transferReference,
    providerTransactionId: 'synthetic-provider-transaction',
    amountKobo: operation.amountKobo,
    currency: operation.currency,
    sourceWalletId: operation.sourceWalletId,
    destinationWalletId: operation.destinationWalletId,
  };

  expect(
    evaluatePrefundedCardContribution({
      operation,
      preflight: reservedPreflight,
      collection: verifiedCollection,
      transfer,
      completion: { status: 'unclaimed' },
      transferContract: 'captured_and_reviewed',
    })
  ).toEqual({
    status: 'ready_for_projection',
    collection: 'verified_success',
    transfer: 'verified_success',
    completion: 'unclaimed',
    refund: 'not_authorized',
    reason: 'trusted_canonical_projection_required',
  });

  const projection = {
    status: 'projection_confirmed',
    projectionId: '90000000-0000-4000-8000-000000000009',
    operationId: operation.operationId,
    integrationId: operation.integrationId,
    merchantId: operation.merchantId,
    customerId: operation.customerId,
    goalId: operation.goalId,
    treasuryBindingId: operation.treasuryBindingId,
    requestFingerprint: operation.requestFingerprint,
    providerTransactionId: transfer.providerTransactionId,
    amountKobo: operation.amountKobo,
    currency: operation.currency,
  };

  expect(
    evaluatePrefundedCardContribution({
      operation,
      preflight: reservedPreflight,
      collection: verifiedCollection,
      transfer,
      completion: projection,
      transferContract: 'captured_and_reviewed',
    })
  ).toEqual({
    status: 'projection_confirmed',
    collection: 'verified_success',
    transfer: 'verified_success',
    completion: 'projection_confirmed',
    refund: 'not_authorized',
    reason: 'trusted_canonical_projection_confirmed',
  });

  for (const completion of [
    { ...projection, operationId: 'a0000000-0000-4000-8000-000000000010' },
    { ...projection, providerTransactionId: 'different-provider-transaction' },
  ])
    expect(
      evaluatePrefundedCardContribution({
        operation,
        preflight: reservedPreflight,
        collection: verifiedCollection,
        transfer,
        completion,
        transferContract: 'captured_and_reviewed',
      })
    ).toEqual({
      status: 'reconciliation_required',
      collection: 'verified_success',
      transfer: 'verified_success',
      completion: 'projection_confirmed',
      refund: 'prohibited_until_transfer_final',
      reason: 'canonical_projection_snapshot_mismatch',
    });
});
