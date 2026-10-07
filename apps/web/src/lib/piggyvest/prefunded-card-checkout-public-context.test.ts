import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { prefundedCardCheckoutFixture } from './prefunded-card-checkout.test-fixture';
import { resolvePrefundedCardCheckoutPublicContext } from './prefunded-card-checkout-public-context';

vi.mock('server-only', () => ({}));

const fixture = prefundedCardCheckoutFixture();
const configuration = {
  environment: 'staging',
  transport: 'tls',
  integrationId: fixture.scope.integrationId,
  merchantId: fixture.scope.merchantId,
  expectedBusinessId: fixture.scope.businessId,
  expectedProjectId: fixture.configuration.customerDatabase.expectedProjectId,
  actualProjectId: fixture.configuration.customerDatabase.actualProjectId,
  allowlistedMerchantIds: [fixture.scope.merchantId],
  allowlistedCustomerIds: [fixture.customerIdentity.customerId],
};

function createSupabase(
  customerEmail = 'checkout@example.com',
  actorEmail = 'checkout@example.com'
) {
  const getUser = vi.fn().mockResolvedValue({
    data: {
      user: {
        app_metadata: { provider: 'email' },
        aud: 'authenticated',
        created_at: '2026-09-20T00:00:00Z',
        email: actorEmail,
        id: fixture.customerIdentity.actorId,
        role: 'authenticated',
        user_metadata: {},
      },
    },
    error: null,
  });
  const maybeSingle = vi
    .fn()
    .mockResolvedValueOnce({
      data: { id: fixture.scope.merchantId },
      error: null,
    })
    .mockResolvedValueOnce({
      data: {
        email: customerEmail,
        id: fixture.customerIdentity.customerId,
        merchant_id: fixture.scope.merchantId,
        user_id: fixture.customerIdentity.actorId,
      },
      error: null,
    })
    .mockResolvedValueOnce({
      data: {
        customer_id: fixture.customerIdentity.customerId,
        id: fixture.customerIdentity.goalId,
        merchant_id: fixture.scope.merchantId,
      },
      error: null,
    });
  const query = { eq: vi.fn(), maybeSingle, select: vi.fn() };
  query.eq.mockReturnValue(query);
  query.select.mockReturnValue(query);
  const from = vi.fn().mockReturnValue(query);
  return {
    from,
    supabase: { auth: { getUser }, from } as unknown as SupabaseClient,
  };
}

describe('first-card public customer context', () => {
  it('derives scoped identity from a real Supabase user with metadata fields', async () => {
    const test = createSupabase();

    await expect(
      resolvePrefundedCardCheckoutPublicContext({
        configuration,
        goalId: fixture.customerIdentity.goalId,
        supabase: test.supabase,
      })
    ).resolves.toEqual({
      status: 'ready',
      actorId: fixture.customerIdentity.actorId,
      customerId: fixture.customerIdentity.customerId,
      email: 'checkout@example.com',
      goalId: fixture.customerIdentity.goalId,
    });
    expect(test.from.mock.calls).toEqual([
      ['merchants'],
      ['customers'],
      ['customer_savings_goals'],
    ]);
  });

  it('refuses an RLS customer whose persisted email differs from the authenticated customer', async () => {
    const test = createSupabase('other@example.com');

    await expect(
      resolvePrefundedCardCheckoutPublicContext({
        configuration,
        goalId: fixture.customerIdentity.goalId,
        supabase: test.supabase,
      })
    ).resolves.toEqual({ status: 'unavailable' });
  });

  it('retains the synthetic identity so an existing payment can still be checked', async () => {
    const test = createSupabase(
      'staging-phone@baci.invalid',
      'staging-phone@baci.invalid'
    );

    await expect(
      resolvePrefundedCardCheckoutPublicContext({
        configuration,
        goalId: fixture.customerIdentity.goalId,
        supabase: test.supabase,
      })
    ).resolves.toMatchObject({
      status: 'ready',
      email: 'staging-phone@baci.invalid',
    });
  });
});
