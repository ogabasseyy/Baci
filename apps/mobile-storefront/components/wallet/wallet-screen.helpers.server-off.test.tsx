import { describe, expect, it } from '@jest/globals';
import { buildWalletTopUpGatewayParams } from './wallet-screen.helpers';

const result = {
  authorization_url: 'https://checkout.example.com/pay',
  gateway: 'paystack' as const,
  reference: 'WAL-1',
};

// Today's legacy card top-up params; PiggyVest off changes nothing.
describe('buildWalletTopUpGatewayParams with the server keeping PiggyVest off', () => {
  it("builds today's wallet checkout params", () => {
    expect(
      buildWalletTopUpGatewayParams({
        activeMerchantId: 'merchant-1',
        amount: 1000,
        result,
      })
    ).toEqual({
      amount: '1000',
      authorizationUrl: 'https://checkout.example.com/pay',
      gateway: 'paystack',
      merchantId: 'merchant-1',
      paymentKind: 'wallet',
      reference: 'WAL-1',
    });
  });
});

describe('bugfix: legacy checkout carried no owner stamp', () => {
  it('stamps the starting account so the gateway can block another one', () => {
    expect(
      buildWalletTopUpGatewayParams({ amount: 1000, result, userId: 'user-a' })
    ).toMatchObject({ userId: 'user-a' });
  });

  it('adds no stamp when there is no signed-in account', () => {
    expect(
      buildWalletTopUpGatewayParams({ amount: 1000, result, userId: null })
    ).not.toHaveProperty('userId');
  });
});
