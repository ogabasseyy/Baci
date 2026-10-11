import { expect, it } from '@jest/globals';
import { PaymentGatewayParamsSchema as schema } from './payment-gateway';

const input = {
  paymentKind: 'primary_wallet_card',
  gateway: 'paystack',
  amount: '1000',
  merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
  reference: 'pvb-first-primary-22222222-2222-4222-8222-222222222222',
  authorizationUrl: 'https://checkout.paystack.com/Synthetic123',
  returnTo: '/wallet',
};
it('accepts the primary checkout without a fake order/goal and preserves the safe return route', () => {
  expect(schema.parse(input)).toMatchObject({
    paymentKind: 'primary_wallet_card',
    returnTo: '/wallet',
  });
});
it.each([
  { paymentKind: 'wallet' },
  { gateway: 'korapay' },
  { merchantId: undefined },
  { reference: 'legacy-ref' },
  { authorizationUrl: 'https://caller.example.com' },
])('rejects legacy confirmation and mismatched primary checkout context', (change) => {
  expect(schema.safeParse({ ...input, ...change }).success).toBe(false);
});
it.each([
  'https://checkout.paystack.com/pay/abc-123_XYZ',
  'https://checkout.paystack.com/abc123?reference=xyz&amount=1000',
])('routes provider checkout URL variants to the gateway', (authorizationUrl) => {
  expect(schema.safeParse({ ...input, authorizationUrl }).success).toBe(true);
});
it.each([
  'http://checkout.paystack.com/Synthetic123',
  'https://checkout.paystack.com.evil.example.com/Synthetic123',
  'https://checkout.paystack.com@evil.example.com/',
])('rejects lookalike checkout hosts for primary routing', (authorizationUrl) => {
  expect(schema.safeParse({ ...input, authorizationUrl }).success).toBe(false);
});
