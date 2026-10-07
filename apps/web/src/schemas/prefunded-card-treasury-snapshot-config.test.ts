import { describe, expect, it } from 'vitest';
import {
  prefundedCardTreasurySnapshotConfigSchema,
  prefundedCardTreasurySnapshotStoreSchemas as storeSchemas,
} from './prefunded-card-treasury-snapshot-config';

const configuration = {
  scope: {
    integrationId: 'd91d9e87-8e0d-44de-9b84-1e1d709633d2',
    merchantId: '10000000-0000-4000-8000-000000000001',
  },
  verifier: {
    environment: 'staging',
    systemIdentifier: '7685292944002592802',
    expiresAt: '2026-09-29T15:59:10Z',
    treasuryBindingId: 'ffffcb16-2e95-5cff-a591-e9cc81cf5f57',
    expectedBusinessId: '01M2381RG34HQJMHQKE7DWDACR',
    sourceWalletId: '01M238A0V75387H4HZ15YFWGX3',
    piggyvest: {
      apiSecret: 'synthetic-provider-secret',
      expectedBusinessId: '01M2381RG34HQJMHQKE7DWDACR',
      expectedCurrency: 'NGN',
      timeoutMs: 500,
      maxResponseBytes: 1024,
    },
  },
  database: {
    environment: 'staging',
    transport: 'tls',
    host: 'piggyvest-db.staging.baci.internal',
    expectedHost: 'piggyvest-db.staging.baci.internal',
    port: 5432,
    login: 'prefunded_snapshot_verifier',
    expectedLogin: 'prefunded_snapshot_verifier',
    database: 'postgres',
    expectedDatabase: 'postgres',
    expectedSystemId: '7685292944002592802',
    certificateAuthority: 'synthetic-ca-pem',
    password: 'A'.repeat(64),
  },
};

describe('prefundedCardTreasurySnapshotConfigSchema', () => {
  it('accepts verifier settings paired with the dedicated TLS login and physical identity', () => {
    expect(
      prefundedCardTreasurySnapshotConfigSchema.safeParse(configuration).success
    ).toBe(true);
  });

  it.each([
    ['wrong login', { login: 'prefunded_treasury_operator' }],
    ['wrong system identity', { expectedSystemId: '1' }],
    ['wrong host', { expectedHost: 'other.staging.baci.internal' }],
    ['wrong database', { expectedDatabase: 'other_database' }],
  ])('rejects %s', (_case, databaseOverride) => {
    expect(
      prefundedCardTreasurySnapshotConfigSchema.safeParse({
        ...configuration,
        database: { ...configuration.database, ...databaseOverride },
      }).success
    ).toBe(false);
  });

  it('rejects config whose verifier and database identities disagree', () => {
    expect(
      prefundedCardTreasurySnapshotConfigSchema.safeParse({
        ...configuration,
        database: { ...configuration.database, expectedSystemId: '1' },
      }).success
    ).toBe(false);
  });

  it.each([
    ['unapproved business', { expectedBusinessId: 'other-business' }],
    ['unapproved source wallet', { sourceWalletId: 'other-wallet' }],
  ])('rejects %s', (_case, verifierOverride) => {
    expect(
      prefundedCardTreasurySnapshotConfigSchema.safeParse({
        ...configuration,
        verifier: { ...configuration.verifier, ...verifierOverride },
      }).success
    ).toBe(false);
  });

  it('rejects a changed verifier deadline', () => {
    expect(
      prefundedCardTreasurySnapshotConfigSchema.safeParse({
        ...configuration,
        verifier: {
          ...configuration.verifier,
          expiresAt: '2026-09-30T00:00:00Z',
        },
      }).success
    ).toBe(false);
  });

  it('rejects a scope outside the approved integration and merchant', () => {
    expect(
      prefundedCardTreasurySnapshotConfigSchema.safeParse({
        ...configuration,
        scope: {
          ...configuration.scope,
          integrationId: '00000000-0000-4000-8000-000000000000',
        },
      }).success
    ).toBe(false);
  });
});

describe('prefundedCardTreasurySnapshotStoreSchemas', () => {
  it('accepts only the SQL-bound snapshot scope', () => {
    expect(
      storeSchemas.scope.safeParse({
        environment: 'staging',
        systemIdentifier: '7685292944002592802',
        treasuryBindingId: 'ffffcb16-2e95-5cff-a591-e9cc81cf5f57',
        expectedBusinessId: '01M2381RG34HQJMHQKE7DWDACR',
        sourceWalletId: '01M238A0V75387H4HZ15YFWGX3',
      }).success
    ).toBe(true);
  });

  it('accepts the exact owner-approved 10,000-kobo snapshot boundary', () => {
    expect(
      storeSchemas.snapshot.safeParse({
        treasuryBindingId: 'ffffcb16-2e95-5cff-a591-e9cc81cf5f57',
        evidenceId: `pvts_${'a'.repeat(64)}`,
        observedAt: '2026-09-27T12:00:00.000Z',
        availableKobo: 10_000,
      }).success
    ).toBe(true);
  });

  it('rejects snapshots above the owner-approved limit or with malformed evidence', () => {
    const base = {
      treasuryBindingId: 'ffffcb16-2e95-5cff-a591-e9cc81cf5f57',
      evidenceId: `pvts_${'a'.repeat(64)}`,
      observedAt: '2026-09-27T12:00:00.000Z',
      availableKobo: 10_001,
    };
    expect(storeSchemas.snapshot.safeParse(base).success).toBe(false);
    expect(
      storeSchemas.snapshot.safeParse({
        ...base,
        availableKobo: 0,
        evidenceId: 'x',
      }).success
    ).toBe(false);
  });

  it('accepts only single-row SQL outcomes and database timestamps', () => {
    expect(
      storeSchemas.verificationRows.safeParse([{ result: 'verified' }]).success
    ).toBe(true);
    expect(
      storeSchemas.databaseTimeRows.safeParse([{ result: new Date() }]).success
    ).toBe(true);
    expect(
      storeSchemas.recordRows.safeParse([{ result: 'duplicate' }]).success
    ).toBe(true);
    expect(
      storeSchemas.recordRows.safeParse([{ result: 'allocated' }]).success
    ).toBe(false);
  });
});
