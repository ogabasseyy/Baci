import { expect, it } from 'vitest';
import { piggyvestPrimarySavingsTransferSchemas as schemas } from './piggyvest-primary-savings-transfer';

it('accepts only pending recovery records without provider wallet identifiers', () => {
  const record = {
    operationId: '00000000-0000-4000-8000-000000000001',
    goalId: '00000000-0000-4000-8000-000000000002',
    amountKobo: 100,
    state: 'reserved',
  };
  expect(schemas.recoveryRows.safeParse([{ result: record }]).success).toBe(
    true
  );
  expect(schemas.recoveryRows.safeParse([{ result: null }]).success).toBe(true);
  expect(
    schemas.recoveryRows.safeParse([
      { result: { ...record, sourceWalletId: 'private' } },
    ]).success
  ).toBe(false);
  expect(
    schemas.recoveryRows.safeParse([
      { result: { ...record, state: 'confirmed' } },
    ]).success
  ).toBe(false);
});

it('rejects client-selected source wallets and fractional kobo', () => {
  const input = {
    goalId: '00000000-0000-4000-8000-000000000001',
    operationId: '00000000-0000-4000-8000-000000000002',
    amountKobo: 100,
  };
  expect(schemas.request.safeParse(input).success).toBe(true);
  expect(
    schemas.request.safeParse({ ...input, sourceWalletId: 'foreign' }).success
  ).toBe(false);
  expect(schemas.request.safeParse({ ...input, amountKobo: 0.5 }).success).toBe(
    false
  );
});
