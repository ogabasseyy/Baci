import { describe, expect, it } from 'vitest';
import { prefundedCardCheckoutRecoveryRunnerStateSchemas as schemas } from './prefunded-card-checkout-recovery-runner-state';

const scope = {
  deployment: 'staging',
  integrationId: '10000000-0000-4000-8000-000000000001',
  merchantId: '10000000-0000-4000-8000-000000000002',
  treasuryBindingId: '10000000-0000-4000-8000-000000000003',
  businessId: 'business_staging',
  systemIdentifier: '7685292944002592802',
  expiresAt: '2026-09-29T15:59:10Z',
  databaseName: 'baci_staging',
};

describe('prefunded first-card recovery runner state schema', () => {
  it('accepts a scoped checkpoint and rejects wrong database or deadline state', () => {
    expect(
      schemas.checkpoint.safeParse({ version: 1, scope, cursor: null }).success
    ).toBe(true);
    for (const wrongScope of [
      { ...scope, systemIdentifier: '1' },
      { ...scope, expiresAt: '2026-09-30T00:00:00Z' },
    ]) {
      expect(
        schemas.checkpoint.safeParse({
          version: 1,
          scope: wrongScope,
          cursor: null,
        }).success
      ).toBe(false);
    }
  });

  it('rejects corrupted stored cursor and unknown checkpoint versions', () => {
    expect(
      schemas.storedCheckpoint.safeParse({
        version: 1,
        scope,
        cursor: { createdAt: 'yesterday', intentId: 'bad' },
      }).success
    ).toBe(false);
    expect(
      schemas.checkpoint.safeParse({ version: 2, scope, cursor: null }).success
    ).toBe(false);
  });

  it('requires the exact staging state directory and matching recovery scope', () => {
    const input = {
      scope,
      recovery: {
        scope: (({ databaseName: _databaseName, ...recoveryScope }) =>
          recoveryScope)(scope),
        authorizerDatabase: {
          environment: 'staging',
          profile: 'checkout_authorizer',
          transport: 'tls',
          host: 'db.staging.example.test',
          expectedHost: 'db.staging.example.test',
          port: 5432,
          login: 'prefunded_authorizer',
          expectedLogin: 'prefunded_authorizer',
          database: scope.databaseName,
          expectedDatabase: scope.databaseName,
          expectedSystemId: scope.systemIdentifier,
          password: 'injected-test-only',
          storageApproved: true,
          expectedProjectId: 'staging-project',
          actualProjectId: 'staging-project',
        },
        provider: {
          ...(({ databaseName: _databaseName, ...recoveryScope }) =>
            recoveryScope)(scope),
          paystackSecret: 'sk_test_value',
          callbackUrl: 'https://staging.ogabassey.com/savings/card-return',
        },
      },
      stateDirectory: '/var/lib/baci-staging/prefunded-first-card',
    };
    expect(schemas.cliConfiguration.safeParse(input).success).toBe(true);
    expect(
      schemas.cliConfiguration.safeParse({
        ...input,
        stateDirectory: '/tmp/state',
      }).success
    ).toBe(false);
  });
});
