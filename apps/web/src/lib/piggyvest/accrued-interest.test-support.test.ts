import { describe, expect, it } from 'vitest';
import {
  configuration,
  dependencies,
  edge,
  identity,
  mapping,
  pageInfo,
  response,
  wallet,
} from './accrued-interest.test-support';

describe('accrued-interest test support', () => {
  it('ties the trusted identity to the configuration, mapping and wallet', () => {
    expect(configuration.integrationId).toBe(identity.integrationId);
    expect(configuration.expectedMerchantId).toBe(identity.merchantId);
    expect(configuration.allowlistedCustomerIds).toContain(identity.customerId);
    expect(mapping).toMatchObject({
      merchant_id: identity.merchantId,
      customer_id: identity.customerId,
      goal_id: identity.goalId,
    });
    expect(wallet.id).toBe(identity.providerWalletId);
    expect(edge).toMatchObject({
      wallet_id: identity.providerWalletId,
      business_id: configuration.expectedBusinessId,
    });
  });

  it('wraps a page in a successful envelope', () => {
    expect(response()).toEqual({
      status: true,
      data: { paginatedPayload: { edges: [edge], pageInfo } },
    });
  });

  it('resolves the identity and mapping through fresh doubles', async () => {
    const options = dependencies();
    expect(await options.resolveTrustedIdentity()).toBe(identity);
    expect(await options.execute()).toEqual({ rows: [mapping] });
    expect(dependencies().execute).not.toBe(options.execute);
  });
});
