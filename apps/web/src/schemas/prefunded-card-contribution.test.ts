import { expect, it } from 'vitest';
import { prefundedCardContributionSchemas as schemas } from './prefunded-card-contribution';

function validInput() {
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
  const transfer = {
    status: 'verified_success',
    reference: operation.transferReference,
    providerTransactionId: 'synthetic-provider-transaction',
    amountKobo: operation.amountKobo,
    currency: operation.currency,
    sourceWalletId: operation.sourceWalletId,
    destinationWalletId: operation.destinationWalletId,
  };
  return {
    operation,
    preflight: {
      status: 'reserved',
      reservationId: '80000000-0000-4000-8000-000000000008',
      operationId: operation.operationId,
      availableGoalCapacityKobo: operation.amountKobo,
      availableFloatKobo: operation.amountKobo,
      reservedTotalKobo: operation.amountKobo,
    },
    collection: {
      status: 'verified_success',
      reference: operation.collectionReference,
      amountKobo: operation.amountKobo,
      currency: operation.currency,
      savedMethodId: operation.savedMethodId,
    },
    transfer,
    completion: {
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
    },
    transferContract: 'captured_and_reviewed',
  };
}

it('accepts a minimal zero-fee operation with verified evidence and a projection snapshot', () => {
  expect(schemas.input.safeParse(validInput()).success).toBe(true);
});

it('rejects a non-zero fee allowance before any advisory decision', () => {
  const input = validInput();
  input.operation.feeAllowanceKobo = 1;
  input.preflight.availableFloatKobo = 10_001;
  input.preflight.reservedTotalKobo = 10_001;

  expect(schemas.input.safeParse(input).success).toBe(false);
});

it.each([
  ['malformed goal scope', { operation: { goalId: 'not-a-uuid' } }],
  ['fractional contribution amount', { operation: { amountKobo: 10_000.5 } }],
  ['zero contribution amount', { operation: { amountKobo: 0 } }],
])('rejects %s', (_name, patch) => {
  const input = validInput();
  Object.assign(input.operation, patch.operation);

  expect(schemas.input.safeParse(input).success).toBe(false);
});

it.each([
  ['missing goal scope', { goalId: undefined }],
  [
    'missing provider transaction identity',
    { providerTransactionId: undefined },
  ],
  ['fractional projected amount', { amountKobo: 10_000.5 }],
])('rejects a projection confirmation with %s', (_name, patch) => {
  const input = validInput();
  Object.assign(input.completion, patch);

  expect(schemas.input.safeParse(input).success).toBe(false);
});
