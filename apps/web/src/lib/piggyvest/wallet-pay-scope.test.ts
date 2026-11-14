import { describe, expect, it } from 'vitest';
import { walletPayScope } from './wallet-pay-scope';

describe('walletPayScope', () => {
  it('takes the integration and business from the runtime and the customer from the verified identity', () => {
    expect(
      walletPayScope(
        {
          businessId: 'business-1',
          configuration: {
            integrationId: '22222222-2222-4222-8222-222222222222',
            environment: 'staging',
          } as never,
        },
        { merchantId: 'm', customerId: 'c', userId: 'u' }
      )
    ).toEqual({
      merchantId: 'm',
      customerId: 'c',
      userId: 'u',
      integrationId: '22222222-2222-4222-8222-222222222222',
      environment: 'staging',
      businessId: 'business-1',
    });
  });
});
