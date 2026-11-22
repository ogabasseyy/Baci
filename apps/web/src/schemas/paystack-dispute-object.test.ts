import { expect, it } from 'vitest';
import { paystackDisputeObjectSchema } from './paystack-dispute-object';

it('preserves supported Paystack dispute representations', () => {
  const payload = {
    id: 12,
    transaction_reference: null,
    transaction: { reference: 'ref' },
  };
  expect(paystackDisputeObjectSchema.parse(payload)).toEqual(payload);
});

it.each([
  null,
  [],
  7,
  'dispute',
])('rejects non-object dispute data %j', (value) => {
  expect(paystackDisputeObjectSchema.safeParse(value).success).toBe(false);
});
