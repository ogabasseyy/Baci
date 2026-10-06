import { describe, expect, it } from 'vitest';
import { piggyvestStagingRuntimeSchema } from './piggyvest-staging-runtime';

const database = {
  environment: 'staging',
  transport: 'local_test',
  socketDirectory: '/private/tmp/baci-piggyvest-runtime.synthetic/socket',
  database: 'piggyvest_local',
  password: 'synthetic-local-only',
  role: 'piggyvest_staging_intake',
  port: 55443,
};
const configuration = {
  intake: {
    environment: 'staging',
    integrationId: '44444444-4444-4444-8444-444444444444',
    secret: 'synthetic-only',
    expectedProjectId: 'synthetic-project',
    actualProjectId: 'synthetic-project',
    rawByteSignatureVerified: true,
    durableAcknowledgementApproved: true,
  },
  intakeDatabase: database,
  workerDatabase: { ...database, role: 'piggyvest_staging_worker' },
};

describe('staging runtime boundary', () => {
  const tlsDatabase = {
    environment: 'staging',
    transport: 'tls',
    host: 'staging.example.test',
    expectedHost: 'staging.example.test',
    database: 'postgres',
    password: 'synthetic-password',
    port: 5432,
    expectedProjectId: 'synthetic-project',
    actualProjectId: 'synthetic-project',
    storageApproved: true,
  };

  it('accepts explicit TLS storage on the same approved project', () => {
    expect(
      piggyvestStagingRuntimeSchema.safeParse({
        ...configuration,
        intakeDatabase: { ...tlsDatabase, role: 'piggyvest_staging_intake' },
        workerDatabase: { ...tlsDatabase, role: 'piggyvest_staging_worker' },
      }).success
    ).toBe(true);
  });

  it.each([
    { host: 'other.example.test', expectedHost: 'other.example.test' },
    { expectedProjectId: 'other-project', actualProjectId: 'other-project' },
    { database: 'other_database' },
    { port: 6432 },
  ])('rejects individually valid but cross-runtime TLS storage %j', (change) => {
    expect(
      piggyvestStagingRuntimeSchema.safeParse({
        ...configuration,
        intakeDatabase: { ...tlsDatabase, role: 'piggyvest_staging_intake' },
        workerDatabase: {
          ...tlsDatabase,
          role: 'piggyvest_staging_worker',
          ...change,
        },
      }).success
    ).toBe(false);
  });

  it('rejects TLS database project identity that differs from webhook configuration', () => {
    const otherProject = {
      ...tlsDatabase,
      expectedProjectId: 'other-project',
      actualProjectId: 'other-project',
    };
    expect(
      piggyvestStagingRuntimeSchema.safeParse({
        ...configuration,
        intakeDatabase: { ...otherProject, role: 'piggyvest_staging_intake' },
        workerDatabase: { ...otherProject, role: 'piggyvest_staging_worker' },
      }).success
    ).toBe(false);
  });

  it('accepts separate least-privilege roles on the same disposable database', () => {
    expect(piggyvestStagingRuntimeSchema.safeParse(configuration).success).toBe(
      true
    );
  });
  it.each([
    { role: 'piggyvest_staging_intake' },
    { role: 'piggyvest_staging_provisioner' },
    { port: 55444 },
    { socketDirectory: '/tmp/baci-piggyvest-runtime.other/socket' },
  ])('rejects mismatched worker identity %j', (change) => {
    expect(
      piggyvestStagingRuntimeSchema.safeParse({
        ...configuration,
        workerDatabase: { ...configuration.workerDatabase, ...change },
      }).success
    ).toBe(false);
  });
  it('rejects missing signature/acknowledgement contract approval', () => {
    expect(
      piggyvestStagingRuntimeSchema.safeParse({
        ...configuration,
        intake: { ...configuration.intake, rawByteSignatureVerified: false },
      }).success
    ).toBe(false);
  });
  it('rejects an unexpected configuration key instead of accepting an ambient connection', () => {
    expect(
      piggyvestStagingRuntimeSchema.safeParse({
        ...configuration,
        connectionString: 'synthetic',
      }).success
    ).toBe(false);
  });
});
