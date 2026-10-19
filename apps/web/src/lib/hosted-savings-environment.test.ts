import { describe, expect, it } from 'vitest';
import { readHostedSavingsEnvironment } from './hosted-savings-environment';
import { prefundedCardCheckoutFixture } from './piggyvest/prefunded-card-checkout.test-fixture';

const checkout = prefundedCardCheckoutFixture();
const publicEnvironment = {
  NODE_ENV: 'production',
  NEXT_PUBLIC_SUPABASE_URL: 'https://staging-auth.ogabassey.com',
  NEXT_PUBLIC_APP_URL: 'https://staging.ogabassey.com',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-public-key',
};
const firstCardEnvironment = {
  ...publicEnvironment,
  BACI_WORKER_PROFILE: 'hosted-first-card-checkout',
  PREFUNDED_CARD_CHECKOUT_PUBLIC_ENABLED: 'true',
  PREFUNDED_CARD_CHECKOUT_PUBLIC_CONFIG: JSON.stringify({
    deployment: 'staging',
    expiresAt: checkout.scope.expiresAt,
    publicOrigin: publicEnvironment.NEXT_PUBLIC_APP_URL,
    authOrigin: publicEnvironment.NEXT_PUBLIC_SUPABASE_URL,
    maximumAmountKobo: 10_000,
    context: {
      environment: 'staging',
      transport: 'tls',
      integrationId: checkout.scope.integrationId,
      merchantId: checkout.scope.merchantId,
      expectedBusinessId: checkout.scope.businessId,
      expectedProjectId:
        checkout.configuration.customerDatabase.expectedProjectId,
      actualProjectId: checkout.configuration.customerDatabase.actualProjectId,
      allowlistedMerchantIds: [checkout.scope.merchantId],
      allowlistedCustomerIds: [checkout.customerIdentity.customerId],
    },
    checkout: checkout.configuration,
  }),
};

describe('hosted savings profile selection', () => {
  it('leaves unrelated application configuration to the default validator', () => {
    expect(readHostedSavingsEnvironment({})).toBeNull();
  });
  it.each([
    'hosted-savings-drafts',
    'hosted-savings-funding',
    'hosted-first-card-checkout',
  ])('rejects incomplete %s configuration without disclosing values', (profile) => {
    expect(() =>
      readHostedSavingsEnvironment({
        BACI_WORKER_PROFILE: profile,
        PRIVATE_SECRET: 'synthetic-hidden-value',
      })
    ).toThrow('Invalid isolated savings staging environment');
  });

  it('recognizes the dedicated first-card profile without returning its server configuration', () => {
    const original = structuredClone(firstCardEnvironment);

    expect(readHostedSavingsEnvironment(firstCardEnvironment)).toEqual({
      ...publicEnvironment,
      BACI_WORKER_PROFILE: 'hosted-first-card-checkout',
      PREFUNDED_CARD_CHECKOUT_PUBLIC_ENABLED: 'true',
    });
    expect(firstCardEnvironment).toEqual(original);
  });

  it('accepts normalized standalone injections without exposing or trusting their contents', () => {
    const standalone = {
      ...firstCardEnvironment,
      HOSTNAME: '0.0.0.0',
      PORT: '3000',
      NEXT_DEPLOYMENT_ID: '',
      __NEXT_PRIVATE_ORIGIN: 'http://localhost:3000',
      __NEXT_PRIVATE_STANDALONE_CONFIG: JSON.stringify({
        output: 'standalone',
        env: {},
        experimental: {},
        authOrigin: 'https://untrusted.example.test',
        provider: 'untrusted',
      }),
    };
    const original = structuredClone(standalone);

    expect(readHostedSavingsEnvironment(standalone)).toEqual(
      readHostedSavingsEnvironment(firstCardEnvironment)
    );
    expect(standalone).toEqual(original);
    expect(() =>
      readHostedSavingsEnvironment({
        ...standalone,
        PREFUNDED_CARD_CHECKOUT_PUBLIC_CONFIG: '{}',
      })
    ).toThrow(/^Invalid isolated savings staging environment$/);
  });

  it.each([
    { PREFUNDED_CARD_PUBLIC_ENABLED: 'true' },
    { SUPABASE_SERVICE_ROLE_KEY: 'synthetic-private-value' },
    {
      PREFUNDED_CARD_CHECKOUT_PUBLIC_CONFIG:
        '{"password":"synthetic-private-value"}',
    },
  ])('rejects unsafe first-card environments with a redacted selector error', (extra) => {
    expect(() =>
      readHostedSavingsEnvironment({ ...firstCardEnvironment, ...extra })
    ).toThrow(/^Invalid isolated savings staging environment$/);
  });

  const legacyEnvironments = [
    {
      ...publicEnvironment,
      BACI_WORKER_PROFILE: 'hosted-savings-drafts',
      PIGGYVEST_HOSTED_DRAFT_STAGING_ENABLED: 'true',
    },
    {
      ...publicEnvironment,
      BACI_WORKER_PROFILE: 'hosted-savings-funding',
      PIGGYVEST_SAVINGS_FUNDING_DISPLAY_ENABLED: 'true',
      PIGGYVEST_SAVINGS_FUNDING_API_SECRET: 'test_key_synthetic',
      PIGGYVEST_SAVINGS_FUNDING_BUSINESS_ID: checkout.scope.businessId,
      PIGGYVEST_SAVINGS_FUNDING_INTEGRATION_ID: checkout.scope.integrationId,
      PIGGYVEST_SAVINGS_FUNDING_MERCHANT_ID: checkout.scope.merchantId,
      PIGGYVEST_SAVINGS_FUNDING_PROJECT_ID: 'staging-test',
      PIGGYVEST_SAVINGS_FUNDING_CUSTOMER_ALLOWLIST:
        checkout.customerIdentity.customerId,
      PIGGYVEST_SAVINGS_FUNDING_FINGERPRINT_KEY:
        'synthetic-fingerprint-key-0000000000',
      PIGGYVEST_SAVINGS_FUNDING_DB_HOST: 'piggyvest-db.staging.baci.internal',
      PIGGYVEST_SAVINGS_FUNDING_DB_PORT: '5432',
      PIGGYVEST_SAVINGS_FUNDING_DB_NAME: 'postgres',
      PIGGYVEST_SAVINGS_FUNDING_DB_PASSWORD: 'synthetic-password',
      PIGGYVEST_SAVINGS_FUNDING_DB_CA:
        '-----BEGIN CERTIFICATE-----\nYQ==\n-----END CERTIFICATE-----',
    },
  ];

  it.each(
    legacyEnvironments
  )('retains $BACI_WORKER_PROFILE without checkout credentials', (environment) => {
    expect(readHostedSavingsEnvironment(environment)?.BACI_WORKER_PROFILE).toBe(
      environment.BACI_WORKER_PROFILE
    );
  });

  it.each(
    legacyEnvironments
  )('rejects first-card settings hidden under $BACI_WORKER_PROFILE', (environment) => {
    for (const extra of [
      { PREFUNDED_CARD_CHECKOUT_PUBLIC_ENABLED: 'true' },
      {
        PREFUNDED_CARD_CHECKOUT_PUBLIC_CONFIG:
          firstCardEnvironment.PREFUNDED_CARD_CHECKOUT_PUBLIC_CONFIG,
      },
    ]) {
      expect(() =>
        readHostedSavingsEnvironment({ ...environment, ...extra })
      ).toThrow(/^Invalid isolated savings staging environment$/);
    }
  });
});
