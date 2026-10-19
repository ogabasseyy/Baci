import { describe, expect, it, vi } from 'vitest';
import { prefundedCardReplayRuntimeSchema as schema } from './prefunded-card-replay-runtime';

function options(transport: 'local_test' | 'tls' = 'local_test') {
  const database = (login: string) => ({
    environment: 'staging',
    login,
    expectedLogin: login,
    port: 5432,
    database: 'prefunded',
    expectedDatabase: 'prefunded',
    expectedSystemId: '123',
    ...(transport === 'local_test'
      ? {
          transport: 'local_test',
          password: 'synthetic-local-only',
          socketDirectory:
            '/private/tmp/baci-prefunded-card-executor.synthetic/socket',
        }
      : {
          transport: 'tls',
          password: 'synthetic-password',
          storageApproved: true,
          host: 'prefunded.example.test',
          expectedHost: 'prefunded.example.test',
          expectedProjectId: 'project',
          actualProjectId: 'project',
          certificateAuthority: 'synthetic-ca',
        }),
  });
  const scope = {
    environment: 'staging',
    integrationId: '10000000-0000-4000-8000-000000000002',
    merchantId: '10000000-0000-4000-8000-000000000003',
    treasuryBindingId: '10000000-0000-4000-8000-000000000006',
    businessId: 'business',
    expectedSystemId: '123',
  };
  return {
    configuration: {
      scope,
      evidence: {
        integrationId: scope.integrationId,
        systemIdentifier: '123',
        webhookSecret: 'synthetic-webhook-secret',
        piggyvest: {
          apiSecret: 'synthetic-api-secret',
          expectedBusinessId: 'business',
        },
      },
      database: {
        treasury: database('prefunded_treasury_operator'),
        ingestion: database('prefunded_evidence'),
      },
    },
    expectedAppSystemId: '123',
    fetchImplementation: vi.fn<typeof fetch>(),
  };
}

describe('prefundedCardReplayRuntimeSchema', () => {
  it.each([
    'local_test',
    'tls',
  ] as const)('accepts matching %s scope without collection or authorizer configuration', (transport) => {
    const input = options(transport);
    const parsed = schema.parse(input);
    expect(parsed.configuration.database.treasury.profile).toBe('worker');
    expect(parsed.configuration.database.ingestion.profile).toBe('evidence');
    expect(parsed.configuration.scope).not.toHaveProperty('batchSize');
    expect(parsed.configuration).not.toHaveProperty('provider');
    expect(parsed.configuration).not.toHaveProperty('paystackSecret');
    expect(parsed.configuration.evidence.piggyvest.expectedCurrency).toBe(
      'NGN'
    );
    expect(input.fetchImplementation).not.toHaveBeenCalled();
  });

  it.each([
    '',
    'not-a-system',
    '123456789012345678901',
    '456',
    null,
    undefined,
  ])('requires the receiver physical system pin %s', (expectedAppSystemId) => {
    expect(
      schema.safeParse({ ...options(), expectedAppSystemId }).success
    ).toBe(false);
  });

  it('pins scope, evidence and both databases independently to the app system', () => {
    const input = options();
    const { configuration } = input;
    for (const changed of [
      {
        ...configuration,
        scope: { ...configuration.scope, expectedSystemId: '456' },
      },
      {
        ...configuration,
        evidence: { ...configuration.evidence, systemIdentifier: '456' },
      },
      ...(['treasury', 'ingestion'] as const).map((role) => ({
        ...configuration,
        database: {
          ...configuration.database,
          [role]: { ...configuration.database[role], expectedSystemId: '456' },
        },
      })),
    ])
      expect(
        schema.safeParse({ ...input, configuration: changed }).success
      ).toBe(false);
  });

  it('pins the evidence integration, business and currency to the reviewed scope', () => {
    const input = options();
    const evidence = input.configuration.evidence;
    for (const changed of [
      { ...evidence, integrationId: '90000000-0000-4000-8000-000000000001' },
      {
        ...evidence,
        piggyvest: { ...evidence.piggyvest, expectedBusinessId: 'other' },
      },
      {
        ...evidence,
        piggyvest: { ...evidence.piggyvest, expectedCurrency: 'USD' },
      },
      {
        ...evidence,
        piggyvest: {
          ...evidence.piggyvest,
          apiBaseUrl: 'https://example.test',
        },
      },
    ])
      expect(
        schema.safeParse({
          ...input,
          configuration: { ...input.configuration, evidence: changed },
        }).success
      ).toBe(false);
  });

  it('requires every scope pin and rejects worker-only batch sizing', () => {
    for (const key of Object.keys(options().configuration.scope)) {
      const input = options();
      Reflect.deleteProperty(input.configuration.scope, key);
      expect(schema.safeParse(input).success).toBe(false);
    }
    const input = options();
    Reflect.set(input.configuration.scope, 'batchSize', 5);
    expect(schema.safeParse(input).success).toBe(false);
  });

  it.each([
    'treasury',
    'ingestion',
  ] as const)('rejects request-selected profiles and arbitrary grants in %s', (role) => {
    for (const injected of [
      { profile: 'worker' },
      { profile: undefined },
      { allowedStatements: [] },
      { login: 'postgres', expectedLogin: 'postgres' },
    ]) {
      const input = options();
      Object.assign(input.configuration.database[role], injected);
      expect(schema.safeParse(input).success).toBe(false);
    }
  });

  it('requires matching database, port and private socket between roles', () => {
    for (const change of [
      { database: 'other', expectedDatabase: 'other' },
      { port: 5433 },
      {
        socketDirectory:
          '/private/tmp/baci-prefunded-card-executor.other/socket',
      },
      { socketDirectory: '/tmp/arbitrary/socket' },
    ]) {
      const input = options();
      Object.assign(input.configuration.database.ingestion, change);
      expect(schema.safeParse(input).success).toBe(false);
    }
  });

  it('requires matching TLS host, project, certificate authority and transport', () => {
    const input = options('tls');
    for (const ingestion of [
      options().configuration.database.ingestion,
      {
        ...input.configuration.database.ingestion,
        host: 'other.example.test',
        expectedHost: 'other.example.test',
      },
      {
        ...input.configuration.database.ingestion,
        expectedProjectId: 'other',
        actualProjectId: 'other',
      },
      {
        ...input.configuration.database.ingestion,
        certificateAuthority: 'other-ca',
      },
      {
        ...input.configuration.database.ingestion,
        certificateAuthority: undefined,
      },
    ])
      expect(
        schema.safeParse({
          ...input,
          configuration: {
            ...input.configuration,
            database: { ...input.configuration.database, ingestion },
          },
        }).success
      ).toBe(false);
  });

  it('rejects unexpected secrets and process capabilities at every configuration boundary', () => {
    for (const field of [
      'paystackSecret',
      'provider',
      'authorizer',
      'reader',
      'execute',
    ]) {
      const input = options();
      for (const boundary of [
        input,
        input.configuration,
        input.configuration.scope,
        input.configuration.evidence,
        input.configuration.evidence.piggyvest,
        input.configuration.database,
        input.configuration.database.treasury,
        input.configuration.database.ingestion,
      ]) {
        Reflect.set(boundary, field, 'unexpected-secret');
        expect(schema.safeParse(input).success).toBe(false);
        Reflect.deleteProperty(boundary, field);
      }
    }
  });

  it('rejects missing credentials or a nonfunction fetch without invoking it', () => {
    const input = options();
    for (const fetchImplementation of [null, undefined, 'fetch', {}])
      expect(schema.safeParse({ ...input, fetchImplementation }).success).toBe(
        false
      );
    expect(
      schema.safeParse({
        ...input,
        configuration: {
          ...input.configuration,
          evidence: { ...input.configuration.evidence, webhookSecret: '' },
        },
      }).success
    ).toBe(false);
    expect(input.fetchImplementation).not.toHaveBeenCalled();
  });
});
