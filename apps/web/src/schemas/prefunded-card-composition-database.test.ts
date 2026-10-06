import { describe, expect, it } from 'vitest';
import { prefundedCardCompositionDatabase as database } from './prefunded-card-composition-database';

function configuration(login = 'prefunded_treasury_operator') {
  return {
    environment: 'staging',
    transport: 'tls',
    host: 'prefunded.example.test',
    expectedHost: 'prefunded.example.test',
    expectedProjectId: 'project',
    actualProjectId: 'project',
    certificateAuthority: 'synthetic-ca',
    storageApproved: true,
    password: 'synthetic-password',
    login,
    expectedLogin: login,
    port: 5432,
    database: 'prefunded',
    expectedDatabase: 'prefunded',
    expectedSystemId: '123',
  };
}

describe('prefunded composition database validation', () => {
  it.each([
    ['worker', 'prefunded_treasury_operator'],
    ['evidence', 'prefunded_evidence'],
    ['authorizer', 'prefunded_authorizer'],
  ] as const)('assigns the fixed %s profile without caller selection', (profile, login) => {
    expect(database.profile(profile).parse(configuration(login)).profile).toBe(
      profile
    );
    expect(
      database.profile(profile).safeParse({ ...configuration(login), profile })
        .success
    ).toBe(false);
    expect(
      database
        .profile(profile)
        .safeParse({ ...configuration(login), profile: undefined }).success
    ).toBe(false);
    expect(
      database
        .profile(profile)
        .safeParse({ ...configuration(login), allowedStatements: [] }).success
    ).toBe(false);
  });

  it('does not confuse independent role credentials with physical database identity', () => {
    const worker = database.profile('worker').parse(configuration());
    const evidence = database.profile('evidence').parse({
      ...configuration('prefunded_evidence'),
      password: 'another-synthetic-password',
    });
    expect(database.samePhysicalIdentity(worker, evidence)).toBe(true);
  });

  it('refuses database, system, port, host, project or trust-root drift', () => {
    const worker = database.profile('worker').parse(configuration());
    for (const change of [
      { database: 'other', expectedDatabase: 'other' },
      { expectedSystemId: '456' },
      { port: 5433 },
      { host: 'other.example.test', expectedHost: 'other.example.test' },
      { expectedProjectId: 'other', actualProjectId: 'other' },
      { certificateAuthority: 'different-ca' },
      { certificateAuthority: undefined },
    ]) {
      const evidence = database.profile('evidence').parse({
        ...configuration('prefunded_evidence'),
        ...change,
      });
      expect(database.samePhysicalIdentity(worker, evidence)).toBe(false);
    }
  });

  it('requires the same private test socket and never mixes transports', () => {
    const local = {
      environment: 'staging',
      transport: 'local_test',
      socketDirectory:
        '/private/tmp/baci-prefunded-card-executor.synthetic/socket',
      password: 'synthetic-local-only',
      login: 'prefunded_treasury_operator',
      expectedLogin: 'prefunded_treasury_operator',
      port: 5432,
      database: 'prefunded',
      expectedDatabase: 'prefunded',
      expectedSystemId: '123',
    };
    const worker = database.profile('worker').parse(local);
    const evidenceConfig = {
      ...local,
      login: 'prefunded_evidence',
      expectedLogin: 'prefunded_evidence',
    };
    expect(
      database.samePhysicalIdentity(
        worker,
        database.profile('evidence').parse(evidenceConfig)
      )
    ).toBe(true);
    const other = database.profile('evidence').parse({
      ...evidenceConfig,
      socketDirectory: '/private/tmp/baci-prefunded-card-executor.other/socket',
    });
    expect(database.samePhysicalIdentity(worker, other)).toBe(false);
    expect(
      database.samePhysicalIdentity(
        worker,
        database.profile('evidence').parse(configuration('prefunded_evidence'))
      )
    ).toBe(false);
  });

  it('rejects malformed database credentials and unexpected secrets', () => {
    for (const change of [
      { login: 'postgres', expectedLogin: 'postgres' },
      { host: 'other.example.test' },
      { expectedProjectId: 'other' },
      { paystackSecret: 'unexpected-secret' },
      { storageApproved: false },
    ])
      expect(
        database.profile('worker').safeParse({ ...configuration(), ...change })
          .success
      ).toBe(false);
  });
});
