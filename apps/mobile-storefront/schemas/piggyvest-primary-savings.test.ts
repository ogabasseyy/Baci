import { expect, it } from '@jest/globals';
import { PiggyvestPrimarySavingsSchemas } from './piggyvest-primary-savings';

it('does not accept unsupported completion statuses or client-selected wallets', () => {
  expect(
    PiggyvestPrimarySavingsSchemas.response.safeParse({
      status: 'accepted',
      operationId: '11111111-1111-4111-8111-111111111111',
    }).success
  ).toBe(false);
  expect(
    PiggyvestPrimarySavingsSchemas.request.safeParse({
      merchantId: '11111111-1111-4111-8111-111111111111',
      goalId: '22222222-2222-4222-8222-222222222222',
      operationId: '33333333-3333-4333-8333-333333333333',
      amountKobo: 100,
      sourceWalletId: 'foreign',
    }).success
  ).toBe(false);
});
