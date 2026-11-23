import { expect, it } from 'vitest';
import { paystackDvaAttemptReceiptSchema } from './paystack-dva-attempt';

it.each([
  'legacy',
  'claimed',
  'pending',
  'refused',
])('accepts the bare %s receipt', (kind) => {
  expect(paystackDvaAttemptReceiptSchema.safeParse({ kind }).success).toBe(
    true
  );
});

it('requires full account details on a saved receipt', () => {
  expect(
    paystackDvaAttemptReceiptSchema.safeParse({
      kind: 'saved',
      reference: 'BAC-AAAAAAAAAAAA',
      dva: { account_number: '1', account_name: 'N', bank_name: 'B' },
    }).success
  ).toBe(true);
  expect(
    paystackDvaAttemptReceiptSchema.safeParse({
      kind: 'saved',
      reference: 'BAC-AAAAAAAAAAAA',
      dva: { account_number: '', account_name: 'N', bank_name: 'B' },
    }).success
  ).toBe(false);
  expect(
    paystackDvaAttemptReceiptSchema.safeParse({ kind: 'other' }).success
  ).toBe(false);
});
