import { describe, expect, it, vi } from 'vitest';
import { createFundingScreenFixture } from './customer-funding-screen.test-fixture';
import { resolvePrefundedCardPublicContext } from './prefunded-card-public-context';

vi.mock('server-only', () => ({}));

describe('public card context', () => {
  it('authenticates and reuses the exact RLS scope for TLS configuration', async () => {
    const fixture = createFundingScreenFixture();
    const result = await resolvePrefundedCardPublicContext({
      configuration: { ...fixture.options.configuration, transport: 'tls' },
      input: { goalId: fixture.identity.goalId },
      supabase: fixture.options.supabase,
    });
    expect(result).toMatchObject({
      status: 'ready',
      configuration: { customerId: fixture.identity.customerId },
    });
  });

  it.each([
    { transport: 'local_test' },
    { environment: 'production' },
    { actualProjectId: 'other' },
    { allowlistedCustomerIds: [] },
  ])('refuses unpinned configuration %j', async (change) => {
    const fixture = createFundingScreenFixture();
    expect(
      await resolvePrefundedCardPublicContext({
        configuration: {
          ...fixture.options.configuration,
          transport: 'tls',
          ...change,
        },
        input: { goalId: fixture.identity.goalId },
        supabase: fixture.options.supabase,
      })
    ).toEqual({ status: 'unavailable' });
  });

  it('does not resolve tables after failed authentication', async () => {
    const fixture = createFundingScreenFixture();
    fixture.getUser.mockRejectedValue(new Error('private auth detail'));
    expect(
      await resolvePrefundedCardPublicContext({
        configuration: { ...fixture.options.configuration, transport: 'tls' },
        input: { goalId: fixture.identity.goalId },
        supabase: fixture.options.supabase,
      })
    ).toEqual({ status: 'unavailable' });
    expect(fixture.options.supabase.from).not.toHaveBeenCalled();
  });
});
