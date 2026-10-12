import { describe, expect, it } from 'vitest';
import { piggyvestPostgresConfigurationSchema as schema } from './piggyvest-postgres-configuration';

const local = {
  environment: 'staging',
  transport: 'local_test',
  socketDirectory: '/private/tmp/baci-piggyvest-runtime.synthetic/socket',
  database: 'piggyvest_local',
  password: 'synthetic-local-only',
  role: 'piggyvest_staging_intake',
  port: 55443,
};
const staging = {
  environment: 'staging',
  transport: 'tls',
  host: 'staging.example.test',
  expectedHost: 'staging.example.test',
  database: 'postgres',
  role: 'piggyvest_staging_provisioner',
  password: 'synthetic-password',
  port: 5432,
  expectedProjectId: 'synthetic-project',
  actualProjectId: 'synthetic-project',
  storageApproved: true,
};

describe('piggyvestPostgresConfigurationSchema', () => {
  it('accepts the policy writer only through explicit synthetic local configuration', () => {
    expect(
      schema.safeParse({ ...local, role: 'piggyvest_staging_policy_writer' })
        .success
    ).toBe(true);
    expect(schema.safeParse({ ...local, role: undefined }).success).toBe(false);
  });
  it('keeps policy writer TLS disabled even with storage approval', () => {
    expect(
      schema.safeParse({ ...staging, role: 'piggyvest_staging_policy_writer' })
        .success
    ).toBe(false);
  });
  it.each([
    local,
    staging,
  ])('accepts only explicit scoped connection settings', (input) => {
    expect(schema.safeParse(input).success).toBe(true);
  });
  it.each([
    { environment: 'production' },
    { role: 'postgres' },
    { role: 'service_role' },
    { role: '' },
    { port: 0 },
    { port: 65536 },
    { database: 'postgres' },
    { socketDirectory: '/tmp/production/socket' },
    { socketDirectory: '/tmp/baci-piggyvest-runtime.a/../socket' },
    { socketDirectory: 'db.example.test' },
    { password: '' },
    { password: 'real-password' },
    { connectionString: 'postgres://ignored' },
    { ssl: false },
  ])('rejects unsafe local connection configuration', (change) => {
    expect(schema.safeParse({ ...local, ...change }).success).toBe(false);
  });
  it.each([
    { storageApproved: false },
    { storageApproved: undefined },
    { host: 'production.example.test' },
    { expectedHost: 'other.example.test' },
    { actualProjectId: 'other-project' },
    { host: '127.0.0.1', expectedHost: '127.0.0.1' },
    { password: '' },
    { password: 'contains\0nul' },
    { database: '' },
    { ssl: { rejectUnauthorized: false } },
    { certificateAuthority: '' },
  ])('rejects unapproved host, project, credentials or TLS overrides', (change) => {
    expect(schema.safeParse({ ...staging, ...change }).success).toBe(false);
  });
});
