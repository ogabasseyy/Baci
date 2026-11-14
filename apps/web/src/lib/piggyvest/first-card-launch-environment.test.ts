import { describe, expect, it } from 'vitest';
import { createFirstCardLaunchEnvironment } from './first-card-launch-environment';
import {
  isPiggyvestFeatureFlagSet,
  isPiggyvestFeatureOn,
} from './piggyvest-feature-on';
import { prefundedCardCheckoutFixture } from './prefunded-card-checkout.test-fixture';

const checkout = prefundedCardCheckoutFixture();
const anon = {
  url: 'https://staging-auth.ogabassey.com',
  key: `e30.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.synthetic`,
};
const configuration = {
  deployment: 'staging',
  expiresAt: checkout.scope.expiresAt,
  publicOrigin: 'https://staging.ogabassey.com',
  authOrigin: anon.url,
  maximumAmountKobo: 10_000,
  context: {
    environment: 'staging',
    transport: 'tls',
    integrationId: checkout.scope.integrationId,
    merchantId: checkout.scope.merchantId,
    expectedBusinessId: checkout.scope.businessId,
    expectedProjectId: 'staging-test',
    actualProjectId: 'staging-test',
    allowlistedMerchantIds: [checkout.scope.merchantId],
    allowlistedCustomerIds: [checkout.customerIdentity.customerId],
  },
  checkout: checkout.configuration,
};
const now = Date.parse('2026-09-28T00:00:00Z');

describe('first-card standalone launch', () => {
  it('constructs the exact service-local environment without forwarding inherited credentials', () => {
    const result = createFirstCardLaunchEnvironment(configuration, anon, now);
    expect(result.BACI_WORKER_PROFILE).toBe('hosted-first-card-checkout');
    expect(result.HOSTNAME).toBe('0.0.0.0');
    expect(result.PORT).toBe('3000');
    expect(result.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe(anon.key);
    expect(result.PREFUNDED_CARD_PUBLIC_ENABLED).toBe('false');
    expect(result.PREFUNDED_CARD_CHECKOUT_MUTATIONS_ENABLED).toBe('false');
    expect(JSON.parse(result.PREFUNDED_CARD_CHECKOUT_PUBLIC_CONFIG)).toEqual(
      configuration
    );
    expect(result.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
  });

  it('forwards financial activation only when explicitly enabled by the owner launcher', () => {
    const result = createFirstCardLaunchEnvironment(
      configuration,
      anon,
      now,
      true
    );

    expect(result.PREFUNDED_CARD_CHECKOUT_MUTATIONS_ENABLED).toBe('true');
  });

  it.each([
    { ...anon, url: 'https://production.example.test' },
    { ...anon, key: 'not-a-jwt' },
    {
      ...anon,
      key: `e30.${Buffer.from('{"role":"service_role"}').toString('base64url')}.synthetic`,
    },
    { ...anon, secret: 'unexpected' },
  ])('refuses malformed or privileged auth config', (value) => {
    expect(() =>
      createFirstCardLaunchEnvironment(configuration, value, now)
    ).toThrow('First-card launch refused');
  });

  it.each([
    'true',
    '1',
    '',
  ])('carries a killed parent switch (%j) into the child and keeps the mutation flag so paid checkouts can refresh', (kill) => {
    const result = createFirstCardLaunchEnvironment(
      configuration,
      anon,
      now,
      true,
      kill
    );
    expect(result.PIGGYVEST_KILL_SWITCH).toBe(kill);
    expect(result.PREFUNDED_CARD_CHECKOUT_MUTATIONS_ENABLED).toBe('true');
  });

  it('a killed child refuses new checkouts but still allows refresh', () => {
    const child = createFirstCardLaunchEnvironment(
      configuration,
      anon,
      now,
      true,
      'true'
    );
    expect(
      isPiggyvestFeatureOn('prefunded_card_checkout_mutations', child)
    ).toBe(false);
    expect(
      isPiggyvestFeatureFlagSet('prefunded_card_checkout_mutations', child)
    ).toBe(true);
  });

  it.each([
    undefined,
    'false',
  ])('leaves a not-killed parent (%j) unchanged', (kill) => {
    const result = createFirstCardLaunchEnvironment(
      configuration,
      anon,
      now,
      true,
      kill
    );
    expect(result.PREFUNDED_CARD_CHECKOUT_MUTATIONS_ENABLED).toBe('true');
    expect(result.PIGGYVEST_KILL_SWITCH).toBe(kill);
  });

  it('refuses expiry and an increased test amount before importing the service', () => {
    expect(() =>
      createFirstCardLaunchEnvironment(
        configuration,
        anon,
        Date.parse(configuration.expiresAt)
      )
    ).toThrow();
    expect(() =>
      createFirstCardLaunchEnvironment(
        { ...configuration, maximumAmountKobo: 10_001 },
        anon,
        now
      )
    ).toThrow();
  });

  it('accepts only the owner-reviewed October 6 lease and refuses unknown leases', () => {
    const renewed = {
      ...configuration,
      expiresAt: '2026-10-06T15:59:10Z',
      checkout: {
        ...configuration.checkout,
        scope: {
          ...configuration.checkout.scope,
          expiresAt: '2026-10-06T15:59:10Z',
        },
        provider: {
          ...configuration.checkout.provider,
          expiresAt: '2026-10-06T15:59:10Z',
        },
      },
    };
    expect(() =>
      createFirstCardLaunchEnvironment(
        renewed,
        anon,
        Date.parse('2026-10-06T15:59:09Z')
      )
    ).not.toThrow();
    expect(() =>
      createFirstCardLaunchEnvironment(
        { ...renewed, expiresAt: '2026-10-07T00:00:00Z' },
        anon,
        Date.parse('2026-10-06T15:59:09Z')
      )
    ).toThrow('First-card launch refused');
  });
});
