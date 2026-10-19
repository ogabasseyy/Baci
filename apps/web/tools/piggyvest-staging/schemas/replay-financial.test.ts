import { describe, expect, it } from 'vitest';
import { replayFinancialSchemas } from './replay-financial';

describe('financial replay configuration', () => {
  const config = {
    host: 'baci-isolated-savings-db-1',
    port: 5432,
    database: 'postgres',
    role: 'piggyvest_staging_ledger_worker',
    password: 'synthetic-password',
    integrationId: '40000000-0000-4000-8000-000000000001',
    businessId: 'business',
  };
  it('accepts an explicit restricted staging connection', () =>
    expect(replayFinancialSchemas.database.safeParse(config).success).toBe(
      true
    ));
  it('accepts the existing treasury authority with an explicit trusted CA', () =>
    expect(
      replayFinancialSchemas.database.safeParse({
        ...config,
        host: 'piggyvest-db.staging.baci.internal',
        role: 'prefunded_treasury_operator',
        ssl: { ca: 'synthetic-certificate' },
      }).success
    ).toBe(true));
  it.each([
    undefined,
    false,
    { ca: '' },
    { ca: 'synthetic', rejectUnauthorized: false },
  ])('rejects unsafe TLS for the treasury authority: %s', (ssl) =>
    expect(
      replayFinancialSchemas.database.safeParse({
        ...config,
        host: 'piggyvest-db.staging.baci.internal',
        role: 'prefunded_treasury_operator',
        ssl,
      }).success
    ).toBe(false));
  it.each([
    { host: 'production' },
    { role: 'service_role' },
    { port: 443 },
    { password: '' },
    { businessId: '' },
    { integrationId: 'wrong' },
    { ssl: false },
  ])('refuses unsafe overrides %s', (override) =>
    expect(
      replayFinancialSchemas.database.safeParse({ ...config, ...override })
        .success
    ).toBe(false));
  it('does not accept unknown database acknowledgements', () =>
    expect(
      replayFinancialSchemas.outcome.safeParse([{ result: 'ok' }]).success
    ).toBe(false));
});
