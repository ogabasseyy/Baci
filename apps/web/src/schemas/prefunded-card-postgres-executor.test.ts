import { describe, expect, it } from 'vitest';

import { prefundedCardPostgresExecutorSchema } from './prefunded-card-postgres-executor';

const localConfiguration = {
  environment: 'staging',
  profile: 'customer',
  transport: 'local_test',
  socketDirectory: '/private/tmp/baci-prefunded-card-executor.synthetic/socket',
  database: 'prefunded_card_local',
  expectedDatabase: 'prefunded_card_local',
  port: 55461,
  login: 'prefunded_treasury_operator',
  expectedLogin: 'prefunded_treasury_operator',
  expectedSystemId: '123456789',
  password: 'synthetic-local-only',
};

describe('prefundedCardPostgresExecutorSchema', () => {
  it('pins checkout constructors to their existing separate logins', () => {
    for (const [profile, login] of [
      ['checkout_customer', 'prefunded_treasury_operator'],
      ['checkout_authorizer', 'prefunded_authorizer'],
    ]) {
      expect(
        prefundedCardPostgresExecutorSchema.safeParse({
          ...localConfiguration,
          profile,
          login,
          expectedLogin: login,
        }).success
      ).toBe(true);
      expect(
        prefundedCardPostgresExecutorSchema.safeParse({
          ...localConfiguration,
          profile,
          login: 'prefunded_evidence',
          expectedLogin: 'prefunded_evidence',
        }).success
      ).toBe(false);
    }
  });
  it('accepts only a pinned private local-test identity', () => {
    expect(
      prefundedCardPostgresExecutorSchema.parse(localConfiguration)
    ).toMatchObject({
      profile: 'customer',
      login: 'prefunded_treasury_operator',
    });
  });

  it.each([
    { login: 'other_login' },
    { expectedDatabase: 'other_database' },
    { expectedSystemId: 'not-a-system-id' },
    { socketDirectory: '/tmp/unpinned/socket' },
    { password: 'not-synthetic' },
  ])('refuses unpinned local-test identity fields', (change) => {
    expect(
      prefundedCardPostgresExecutorSchema.safeParse({
        ...localConfiguration,
        ...change,
      }).success
    ).toBe(false);
  });

  it('refuses a profile paired with a different pinned login', () => {
    expect(
      prefundedCardPostgresExecutorSchema.safeParse({
        ...localConfiguration,
        profile: 'authorizer',
      }).success
    ).toBe(false);
  });

  it.each([
    'customer',
    'worker',
    'reversal',
  ] as const)('pins the %s constructor to the shared treasury operator', (profile) => {
    expect(
      prefundedCardPostgresExecutorSchema.parse({
        ...localConfiguration,
        profile,
      }).login
    ).toBe('prefunded_treasury_operator');
  });

  it('requires the configured TLS host, database, login, and project identity', () => {
    expect(
      prefundedCardPostgresExecutorSchema.safeParse({
        environment: 'staging',
        profile: 'worker',
        transport: 'tls',
        host: 'prefunded-db.example.test',
        expectedHost: 'prefunded-db.example.test',
        database: 'prefunded_card_staging',
        expectedDatabase: 'prefunded_card_staging',
        login: 'prefunded_treasury_operator',
        expectedLogin: 'prefunded_treasury_operator',
        expectedSystemId: '123456789',
        port: 5432,
        password: 'synthetic-tls-password',
        storageApproved: true,
        expectedProjectId: 'prefunded-project',
        actualProjectId: 'prefunded-project',
      }).success
    ).toBe(true);
  });
});
