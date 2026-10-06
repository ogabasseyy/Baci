import { describe, expect, it } from 'vitest';
import { prefundedCardCheckoutFixture } from '@/lib/piggyvest/prefunded-card-checkout.test-fixture';
import { prefundedCardCheckoutPublicSchemas as schemas } from './prefunded-card-checkout-public-runtime';

const state = {
  intentId: '10000000-0000-4000-8000-000000000001',
  goalId: '20000000-0000-4000-8000-000000000001',
  amountKobo: 10_000,
  currency: 'NGN',
  status: 'ready',
  authorizationUrl: 'https://checkout.paystack.com/firstCardTest',
};

describe('public first-card checkout response schemas', () => {
  it('accepts only the public checkout state fields needed by mobile', () => {
    expect(schemas.state.parse(state)).toEqual(state);
  });

  it('accepts a public retirement state without a checkout URL', () => {
    expect(
      schemas.state.parse({
        ...state,
        status: 'retired_unconfirmed',
        authorizationUrl: undefined,
      }).status
    ).toBe('retired_unconfirmed');
  });

  it.each([
    { ...state, email: 'customer@example.test' },
    { ...state, authorizationUrl: undefined },
    { ...state, amountKobo: 0 },
  ])('rejects private, incomplete, or nonpositive first-card state', (value) => {
    expect(schemas.state.safeParse(value).success).toBe(false);
  });

  it('requires a nonnegative safe capability maximum', () => {
    expect(
      schemas.capability.safeParse({
        goalId: state.goalId,
        enabled: true,
        maximumAmountKobo: Number.MAX_SAFE_INTEGER + 1,
        currency: 'NGN',
      }).success
    ).toBe(false);
  });

  it('accepts the approved October lease and rejects arbitrary deadlines', () => {
    const fixture = prefundedCardCheckoutFixture();
    const renewed = {
      deployment: 'staging',
      publicOrigin: 'https://staging.ogabassey.com',
      authOrigin: 'https://staging-auth.ogabassey.com',
      maximumAmountKobo: 10_000,
      context: {
        environment: 'staging',
        transport: 'tls',
        integrationId: fixture.scope.integrationId,
        merchantId: fixture.scope.merchantId,
        expectedBusinessId: fixture.scope.businessId,
        expectedProjectId: 'staging-test',
        actualProjectId: 'staging-test',
        allowlistedMerchantIds: [fixture.scope.merchantId],
        allowlistedCustomerIds: [fixture.customerIdentity.customerId],
      },
      expiresAt: '2026-10-06T15:59:10Z',
      checkout: {
        ...fixture.configuration,
        scope: {
          ...fixture.scope,
          expiresAt: '2026-10-06T15:59:10Z',
        },
        provider: {
          ...fixture.configuration.provider,
          expiresAt: '2026-10-06T15:59:10Z',
          paystackSecret: 'sk_test_checkoutsecret',
        },
      },
    };
    expect(schemas.configuration.safeParse(renewed).success).toBe(true);
    expect(
      schemas.configuration.safeParse({
        ...renewed,
        expiresAt: '2026-10-07T00:00:00Z',
      }).success
    ).toBe(false);
  });
});
