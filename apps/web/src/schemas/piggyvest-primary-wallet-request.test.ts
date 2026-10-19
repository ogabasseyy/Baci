import { describe, expect, it } from 'vitest';
import {
  piggyvestPrimaryWalletQuerySchema as querySchema,
  piggyvestPrimaryWalletRequestSchema as schema,
} from './piggyvest-primary-wallet-request';

const input = {
  merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
  consent: true,
  bvn: '00000000000',
};
describe('primary wallet API request', () => {
  it('accepts only a merchant selector for authenticated account reads', () => {
    expect(
      querySchema.safeParse({ merchantId: input.merchantId }).success
    ).toBe(true);
    expect(
      querySchema.safeParse({
        merchantId: input.merchantId,
        walletId: 'injected',
      }).success
    ).toBe(false);
    expect(querySchema.safeParse({ merchantId: 'invalid' }).success).toBe(
      false
    );
  });
  it('accepts consent and BVN with a merchant selector', () => {
    expect(schema.safeParse(input).success).toBe(true);
  });
  it('rejects user-selected provider and customer identifiers', () => {
    expect(schema.safeParse({ ...input, customerId: 'injected' }).success).toBe(
      false
    );
    expect(
      schema.safeParse({ ...input, providerWalletId: 'injected' }).success
    ).toBe(false);
  });
});
