import { expect, it } from 'vitest';
import { piggyvestPrimaryInflowRuntimeSchema as schema } from './piggyvest-primary-inflow-runtime';

it('does not accept a privileged or provisioning login for inflow credits', () => {
  const database = {
    host: 'db.example.com',
    port: 5432,
    name: 'postgres',
    login: 'service_role',
    password: 'test-only',
    certificateAuthority: 'test-only',
  };
  const config = {
    integrationId: '00000000-0000-4000-8000-000000000001',
    environment: 'staging',
    database,
  };
  expect(schema.safeParse(config).success).toBe(false);
  expect(
    schema.safeParse({
      ...config,
      database: { ...database, login: 'baci_piggyvest_primary_evidence' },
    }).success
  ).toBe(true);
});
