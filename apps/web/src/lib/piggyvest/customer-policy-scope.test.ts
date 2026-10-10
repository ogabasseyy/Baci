import { describe, expect, it, vi } from 'vitest';
import { createFundingScreenFixture } from './customer-funding-screen.test-fixture';
import { resolvePiggyvestCustomerScope } from './customer-policy-scope';

vi.mock('server-only', () => ({}));

describe('customer scope shared RLS projection', () => {
  it('returns only linked allowlisted customer and goal scope', async () => {
    const fixture = createFundingScreenFixture();
    const actorId = (await fixture.getUser()).data.user.id;
    const result = await resolvePiggyvestCustomerScope({
      configuration: {
        environment: 'staging',
        integrationId: fixture.identity.integrationId,
        expectedBusinessId: 'synthetic-business',
        merchantId: fixture.identity.merchantId,
        allowlistedCustomerIds: [fixture.identity.customerId],
      },
      actorId,
      goalId: fixture.identity.goalId,
      supabase: fixture.options.supabase,
    });
    expect(result).toEqual({
      status: 'ready',
      actorId,
      configuration: {
        environment: 'staging',
        integrationId: fixture.identity.integrationId,
        expectedBusinessId: 'synthetic-business',
        merchantId: fixture.identity.merchantId,
        customerId: fixture.identity.customerId,
        goalId: fixture.identity.goalId,
      },
    });
  });

  it('refuses a customer row belonging to a different signed-in user', async () => {
    const fixture = createFundingScreenFixture();
    const result = await resolvePiggyvestCustomerScope({
      configuration: {
        environment: 'staging',
        integrationId: fixture.identity.integrationId,
        expectedBusinessId: 'synthetic-business',
        merchantId: fixture.identity.merchantId,
        allowlistedCustomerIds: [fixture.identity.customerId],
      },
      actorId: fixture.identity.customerId,
      goalId: fixture.identity.goalId,
      supabase: fixture.options.supabase,
    });
    expect(result).toEqual({ status: 'unavailable' });
  });
});
