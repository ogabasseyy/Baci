import { describe, expect, it } from 'vitest';
import { prefundedCardProviderTestFixture as fixture } from '@/lib/piggyvest/prefunded-card-provider.test-fixture';
import { prefundedCardCompositionSchema } from './prefunded-card-composition';

function configuration(transport: 'local_test' | 'tls' = 'local_test') {
  const databaseFor = (login: string) => ({
    environment: 'staging',
    login,
    expectedLogin: login,
    database: 'prefunded_card_local',
    expectedDatabase: 'prefunded_card_local',
    expectedSystemId: '123',
    port: 55461,
    ...(transport === 'local_test'
      ? {
          transport: 'local_test',
          socketDirectory:
            '/private/tmp/baci-prefunded-card-executor.synthetic/socket',
          password: 'synthetic-local-only',
        }
      : {
          transport: 'tls',
          host: 'prefunded.example.test',
          expectedHost: 'prefunded.example.test',
          password: 'synthetic-tls-password',
          storageApproved: true,
          expectedProjectId: 'prefunded-project',
          actualProjectId: 'prefunded-project',
          certificateAuthority: 'synthetic-certificate',
        }),
  });
  return {
    worker: {
      environment: 'staging',
      integrationId: fixture.claim.integrationId,
      merchantId: fixture.claim.merchantId,
      treasuryBindingId: fixture.claim.treasuryBindingId,
      businessId: fixture.claim.businessId,
      expectedSystemId: '123',
    },
    provider: structuredClone(fixture.providerSettings),
    evidence: {
      integrationId: fixture.claim.integrationId,
      systemIdentifier: '123',
      webhookSecret: 'synthetic-webhook-secret',
      piggyvest: structuredClone(fixture.providerSettings.piggyvest),
    },
    database: {
      treasury: databaseFor('prefunded_treasury_operator'),
      ingestion: databaseFor('prefunded_evidence'),
      authorizer: databaseFor('prefunded_authorizer'),
    },
  };
}

describe('prefundedCardCompositionSchema', () => {
  it.each([
    'local_test',
    'tls',
  ] as const)('assigns fixed role profiles for matching %s configuration', (transport) => {
    const parsed = prefundedCardCompositionSchema.parse(
      configuration(transport)
    );
    expect(parsed.database.treasury.profile).toBe('worker');
    expect(parsed.database.ingestion.profile).toBe('evidence');
    expect(parsed.database.authorizer.profile).toBe('authorizer');
    expect(parsed.worker.batchSize).toBe(5);
  });

  it.each([
    'treasury',
    'ingestion',
    'authorizer',
  ] as const)('rejects a supplied profile or statement override in %s configuration', (role) => {
    const configured = configuration();
    for (const injected of [
      { profile: 'worker' },
      { allowedStatements: ['SELECT 1'] },
    ]) {
      expect(
        prefundedCardCompositionSchema.safeParse({
          ...configured,
          database: {
            ...configured.database,
            [role]: { ...configured.database[role], ...injected },
          },
        }).success
      ).toBe(false);
    }
  });

  it.each([
    'ingestion',
    'authorizer',
  ] as const)('rejects a different physical database endpoint for %s', (role) => {
    const configured = configuration();
    for (const change of [
      { expectedSystemId: '456' },
      { database: 'another_database', expectedDatabase: 'another_database' },
      { port: 55462 },
      {
        socketDirectory:
          '/private/tmp/baci-prefunded-card-executor.other/socket',
      },
    ]) {
      expect(
        prefundedCardCompositionSchema.safeParse({
          ...configured,
          database: {
            ...configured.database,
            [role]: { ...configured.database[role], ...change },
          },
        }).success
      ).toBe(false);
    }
  });

  it.each([
    'ingestion',
    'authorizer',
  ] as const)('rejects mixed transport and different TLS host, project or CA for %s', (role) => {
    const configured = configuration('tls');
    for (const database of [
      configuration().database[role],
      {
        ...configured.database[role],
        host: 'other.example.test',
        expectedHost: 'other.example.test',
      },
      {
        ...configured.database[role],
        expectedProjectId: 'another-project',
        actualProjectId: 'another-project',
      },
      { ...configured.database[role], certificateAuthority: 'another-ca' },
    ]) {
      expect(
        prefundedCardCompositionSchema.safeParse({
          ...configured,
          database: { ...configured.database, [role]: database },
        }).success
      ).toBe(false);
    }
  });

  it.each([
    ['integrationId', '90000000-0000-4000-8000-000000000001'],
    ['merchantId', '90000000-0000-4000-8000-000000000002'],
    ['treasuryBindingId', '90000000-0000-4000-8000-000000000003'],
    ['businessId', 'another-business'],
    ['expectedSystemId', '456'],
  ])('rejects mismatched worker %s', (key, value) => {
    const configured = configuration();
    expect(
      prefundedCardCompositionSchema.safeParse({
        ...configured,
        worker: { ...configured.worker, [key]: value },
      }).success
    ).toBe(false);
  });

  it('rejects evidence from a different integration or physical system', () => {
    const configured = configuration();
    for (const change of [
      { integrationId: '90000000-0000-4000-8000-000000000001' },
      { systemIdentifier: '456' },
    ]) {
      expect(
        prefundedCardCompositionSchema.safeParse({
          ...configured,
          evidence: { ...configured.evidence, ...change },
        }).success
      ).toBe(false);
    }
  });

  it('rejects evidence provider credential, business and policy drift', () => {
    const configured = configuration();
    for (const change of [
      { apiSecret: 'another-secret' },
      { expectedBusinessId: 'another-business' },
      { expectedCurrency: 'USD' },
      { timeoutMs: 1000 },
      { maxResponseBytes: 2048 },
    ]) {
      expect(
        prefundedCardCompositionSchema.safeParse({
          ...configured,
          evidence: {
            ...configured.evidence,
            piggyvest: { ...configured.evidence.piggyvest, ...change },
          },
        }).success
      ).toBe(false);
    }
  });

  it('rejects swapping authorizer and treasury credentials', () => {
    const configured = configuration();
    expect(
      prefundedCardCompositionSchema.safeParse({
        ...configured,
        database: {
          ...configured.database,
          authorizer: configured.database.treasury,
        },
      }).success
    ).toBe(false);
  });

  it('rejects request-style profile selection at the composition boundary', () => {
    expect(
      prefundedCardCompositionSchema.safeParse({
        ...configuration(),
        profile: 'worker',
      }).success
    ).toBe(false);
  });
});
