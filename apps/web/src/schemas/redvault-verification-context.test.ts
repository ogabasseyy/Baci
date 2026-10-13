import { describe, expect, it } from 'vitest';
import { OGABASSEY_MERCHANT_ID } from '@/config/ogabassey';
import { redvaultVerificationContextSchema } from './redvault-verification-context';

const context = {
  acceptedFilterPolicyHash: 'a'.repeat(64),
  amountKobo: 9500,
  currency: 'NGN',
  customerEmail: 'customer@example.test',
  issuerName: 'UBA TEST BANK',
  merchantId: OGABASSEY_MERCHANT_ID,
  orderId: '11111111-1111-4111-8111-111111111111',
  reference: 'RV-test',
  transactionId: '22222222-2222-4222-8222-222222222222',
  verificationDomain: 'test',
};
describe('REDVAULT verification context schema', () => {
  it('accepts the exact server-owned context', () => {
    expect(redvaultVerificationContextSchema.parse(context)).toEqual(context);
  });
  it.each([
    { merchantId: context.orderId },
    { amountKobo: 0 },
    { amountKobo: 1.5 },
    { amountKobo: Number.MAX_SAFE_INTEGER + 1 },
    { verificationDomain: 'unknown' },
    { acceptedFilterPolicyHash: null },
    { trusted: true },
  ])('rejects unsafe context %j', (change) => {
    expect(
      redvaultVerificationContextSchema.safeParse({ ...context, ...change })
        .success
    ).toBe(false);
  });
});
