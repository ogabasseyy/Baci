import { expect, it } from 'vitest';
import { prefundedCardOperationStoreSchemas as schemas } from './prefunded-card-storage';

it('rejects incomplete or manufactured verification capabilities', () => {
  expect(
    schemas.reconciliationRows.safeParse([
      { result: { outcome: 'verify_only' } },
    ]).success
  ).toBe(false);
  expect(
    schemas.reconciliationRows.safeParse([
      { result: { outcome: 'leased', token: 'fake' } },
    ]).success
  ).toBe(false);
  expect(
    schemas.reconciliationRows.safeParse([{ result: { outcome: 'leased' } }])
      .success
  ).toBe(true);
});

it('reserves a safe integer for the next dispatch fence', () => {
  expect(schemas.claimFence.safeParse(Number.MAX_SAFE_INTEGER).success).toBe(
    false
  );
  expect(schemas.claimFence.parse(0)).toBe(0);
});

it('refuses a claimed send without its immutable treasury and customer scope', () => {
  const identifier = '10000000-0000-4000-8000-000000000001';
  expect(
    schemas.claimRows.safeParse([
      {
        result: {
          outcome: 'claimed',
          operationId: identifier,
          fence: 1,
          request: {
            collectionReference: 'collection',
            transferReference: 'transfer',
            amountKobo: 100,
            currency: 'NGN',
            savedMethodId: identifier,
            destinationWalletId: 'wallet',
            destinationCustomerId: 'customer',
          },
        },
      },
    ]).success
  ).toBe(false);
});
