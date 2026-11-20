import { expect, it } from 'vitest';
import { bankCardOfferWebhookTransactionSchema } from './bank-card-offer-webhook-transaction';

const transaction = {
  id: 'f37548d2-5d3a-41cf-8109-6a82a1684567',
  merchant_id: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
  order_id: 'b32deabd-77d7-45db-b28d-ccdd58240516',
  gateway: 'paystack',
  gateway_reference: 'BCO-1234567890abcdef1234567890abcdef',
  platform_fee: null,
};

it.each([
  95.01,
  '95.01',
])('normalizes a major-unit transaction amount %s', (amount) => {
  expect(
    bankCardOfferWebhookTransactionSchema.parse({ ...transaction, amount })
      .amount
  ).toBe(95.01);
});

it.each([
  0,
  -1,
  95.001,
  '95.001',
  '1e3',
  Number.MAX_SAFE_INTEGER,
])('rejects an invalid transaction amount %s', (amount) => {
  expect(
    bankCardOfferWebhookTransactionSchema.safeParse({ ...transaction, amount })
      .success
  ).toBe(false);
});
