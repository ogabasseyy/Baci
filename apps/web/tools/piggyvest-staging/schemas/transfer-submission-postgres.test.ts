import { describe, expect, it } from 'vitest';
import { transferSubmissionPostgresSchemas } from './transfer-submission-postgres';

const config = {
  host: 'baci-isolated-savings-db-1',
  port: 5432,
  database: 'postgres',
  role: 'piggyvest_staging_submission_writer',
  transport: 'private-internal',
  password: 'synthetic-password',
  expectedSystemId: '9876543210',
  businessId: 'business-001',
  integrationId: 'integration-001',
};

describe('transfer submission Postgres schemas', () => {
  it('accepts only the pinned staging database configuration', () => {
    expect(transferSubmissionPostgresSchemas.database.parse(config)).toEqual(
      config
    );
  });

  it.each([
    { host: 'production.example' },
    { database: 'production' },
    { role: 'postgres' },
    { expectedSystemId: 'not-numeric' },
    { expectedSystemId: undefined },
    { transport: 'public-host' },
    { businessId: '' },
    { integrationId: '' },
    { unexpected: true },
  ])('refuses unpinned database configuration %#', (override) => {
    expect(() =>
      transferSubmissionPostgresSchemas.database.parse({
        ...config,
        ...override,
      })
    ).toThrow();
  });

  it('accepts bounded string and safe integer statement parameters', () => {
    expect(
      transferSubmissionPostgresSchemas.parameters.safeParse([
        '9876543210',
        'a0065070-dc32-45d2-9c01-871a27abfd10',
        'reference-001',
        'c0065070-dc32-45d2-9c01-871a27abfd10',
        '43e157b6-179c-432a-9392-e0827da96d82',
        'ledger-wallet-001',
        500_000,
        'NGN',
        'source-wallet-001',
        '058:6789',
        'bank',
        'provider-customer-001',
        'business-001',
        'integration-001',
      ]).success
    ).toBe(true);
  });

  it.each(
    [
      [
        '9876543210',
        'invalid-uuid',
        'reference-001',
        'c0065070-dc32-45d2-9c01-871a27abfd10',
        '43e157b6-179c-432a-9392-e0827da96d82',
        'ledger-wallet-001',
        500_000,
        'NGN',
        'source-wallet-001',
        '058:6789',
        'bank',
        'provider-customer-001',
        'business-001',
        'integration-001',
      ],
      [
        '9876543210',
        'a0065070-dc32-45d2-9c01-871a27abfd10',
        'reference-001',
        'c0065070-dc32-45d2-9c01-871a27abfd10',
        '43e157b6-179c-432a-9392-e0827da96d82',
        'ledger-wallet-001',
        Number.MAX_SAFE_INTEGER + 1,
        'NGN',
        'source-wallet-001',
        '058:6789',
        'bank',
        'provider-customer-001',
        'business-001',
        'integration-001',
      ],
      [
        '9876543210',
        'a0065070-dc32-45d2-9c01-871a27abfd10',
        'reference-001',
        'c0065070-dc32-45d2-9c01-871a27abfd10',
        '43e157b6-179c-432a-9392-e0827da96d82',
        'ledger-wallet-001',
        500_000,
        'USD',
        'source-wallet-001',
        '058:6789',
        'bank',
        'provider-customer-001',
        'business-001',
        'integration-001',
      ],
      [
        '7685292944002592802',
        'a0065070-dc32-45d2-9c01-871a27abfd10',
        'reference-001',
        'c0065070-dc32-45d2-9c01-871a27abfd10',
        '43e157b6-179c-432a-9392-e0827da96d82',
        'ledger-wallet-001',
        500_000,
        'NGN',
        'source-wallet-001',
        '058:6789',
        'bank',
        'provider-customer-001',
        'business-001',
        'integration-001',
        'provider-transaction-001',
        'pending',
      ],
    ].map((parameters) => [parameters] as const)
  )('rejects malformed or oversized parameters %#', (parameters) => {
    expect(
      transferSubmissionPostgresSchemas.parameters.safeParse(parameters).success
    ).toBe(false);
  });
});
