import { describe, expect, it } from 'vitest';
import { prefundedCardCheckoutFixture } from '@/lib/piggyvest/prefunded-card-checkout.test-fixture';
import { prefundedCardCheckoutCompositionSchema as schema } from './prefunded-card-checkout-composition';

const { configuration } = prefundedCardCheckoutFixture();
describe('first-card composition identity', () => {
  it('accepts separate restricted logins pinned to the same TLS staging database', () => {
    expect(schema.safeParse(configuration).success).toBe(true);
  });
  it('rejects mismatched databases, projects, roles and provider scopes', () => {
    for (const override of [
      { host: 'foreign.example.test', expectedHost: 'foreign.example.test' },
      { database: 'foreign_db', expectedDatabase: 'foreign_db' },
      { expectedProjectId: 'foreign', actualProjectId: 'foreign' },
      { expectedSystemId: '12345' },
      { profile: 'authorizer' },
      { port: 6432 },
    ])
      expect(
        schema.safeParse({
          ...configuration,
          verifierDatabase: {
            ...configuration.verifierDatabase,
            ...override,
          },
        }).success
      ).toBe(false);
    expect(
      schema.safeParse({
        ...configuration,
        provider: {
          ...configuration.provider,
          merchantId: configuration.scope.integrationId,
        },
      }).success
    ).toBe(false);
  });
  it('rejects selecting the legacy customer profile and unexpected runtime capabilities', () => {
    expect(
      schema.safeParse({
        ...configuration,
        customerDatabase: {
          ...configuration.customerDatabase,
          profile: 'customer',
        },
      }).success
    ).toBe(false);
    expect(
      schema.safeParse({ ...configuration, unrestrictedDispatch: true }).success
    ).toBe(false);
  });
});
