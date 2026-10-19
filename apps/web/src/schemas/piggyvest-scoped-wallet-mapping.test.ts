import { describe, expect, it } from 'vitest';
import { piggyvestScopedWalletMappingSchemas as schemas } from './piggyvest-scoped-wallet-mapping';

describe('piggyvestScopedWalletMappingSchemas', () => {
  it('accepts a staging-local scope and opaque provider identifiers', () => {
    expect(
      schemas.scope.safeParse({
        merchantId: '10000000-0000-4000-8000-000000000001',
        customerId: '20000000-0000-4000-8000-000000000001',
        goalId: '30000000-0000-4000-8000-000000000001',
      }).success
    ).toBe(true);
    expect(
      schemas.response.safeParse([
        {
          provider_wallet_id: 'wallet-1',
          provider_customer_id: 'customer-1',
        },
      ]).success
    ).toBe(true);
  });

  it('rejects response rows outside the restricted provider projection', () => {
    expect(
      schemas.response.safeParse([
        {
          provider_wallet_id: 'wallet-1',
          provider_customer_id: 'customer-1',
          merchant_id: '10000000-0000-4000-8000-000000000001',
        },
      ]).success
    ).toBe(false);
  });
});
