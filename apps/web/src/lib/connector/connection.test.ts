import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type {
  ConnectorConnectRequest,
  ConnectorGrantRecord,
} from '@/schemas/connector';
import {
  CONNECTOR_GRANT_METADATA_COLUMNS,
  canManageConnectorConnection,
  connectionMatchesRequest,
  connectorManagementErrorToHttp,
  connectorRequestFingerprint,
  newConnectorConnectionId,
  newConnectorTokenPair,
  toConnectorConnectionView,
} from './connection';

const MERCHANT = '11111111-1111-1111-1111-111111111111';
const USER = '33333333-3333-3333-3333-333333333333';
const BRANCH = '44444444-4444-4444-4444-444444444444';
const NOW = new Date('2026-10-01T12:00:00.000Z');

function makeRow(
  overrides: Partial<ConnectorGrantRecord> = {}
): ConnectorGrantRecord {
  return {
    id: '55555555-5555-5555-5555-555555555555',
    connection_id: `muse_${MERCHANT}_abc123`,
    user_id: USER,
    merchant_id: MERCHANT,
    branch_ids: [BRANCH],
    merchant_wide: false,
    scopes: ['orders:read'],
    status: 'active',
    version: 1,
    expires_at: null,
    revoked_at: null,
    revoke_reason: null,
    created_at: '2026-10-01T11:00:00.000Z',
    updated_at: '2026-10-01T11:00:00.000Z',
    ...overrides,
  };
}

describe('connector connection helpers', () => {
  it('preserves a finite lifetime on retries and normalizes timestamp offsets', () => {
    const request: ConnectorConnectRequest = {
      merchantId: MERCHANT,
      branchIds: [BRANCH],
      scopes: ['orders:read'],
      merchantWide: false,
      expiresInSeconds: 3600,
    };
    const expiry = '2026-10-01T13:00:00.000Z';
    const fingerprint = connectorRequestFingerprint(request, expiry);
    const connection = toConnectorConnectionView(
      makeRow({ expires_at: expiry }),
      NOW
    );
    expect(connectionMatchesRequest(connection, fingerprint, request)).toBe(
      true
    );
    expect(
      connectorRequestFingerprint(request, '2026-10-01T14:00:00+01:00')
    ).toBe(fingerprint);
    expect(
      connectionMatchesRequest(connection, fingerprint, {
        ...request,
        expiresInSeconds: 7200,
      })
    ).toBe(false);
    expect(
      connectionMatchesRequest(
        { ...connection, expiresAt: '2026-10-01T14:00:00Z' },
        fingerprint,
        request
      )
    ).toBe(false);
  });

  it('treats permission arrays as sets while detecting live permission drift', () => {
    const request: ConnectorConnectRequest = {
      merchantId: MERCHANT,
      branchIds: [BRANCH],
      scopes: ['orders:read', 'inventory:read'],
      merchantWide: false,
      expiresInSeconds: null,
    };
    const fingerprint = connectorRequestFingerprint(request, null);
    expect(
      connectorRequestFingerprint(
        {
          ...request,
          scopes: ['inventory:read', 'orders:read'],
          branchIds: [BRANCH, BRANCH],
        },
        null
      )
    ).toBe(fingerprint);
    const connection = toConnectorConnectionView(makeRow(), NOW);
    expect(connectionMatchesRequest(connection, fingerprint, request)).toBe(
      false
    );
    expect(connectionMatchesRequest(connection, null, request)).toBe(false);
  });

  it('gates management to owners only', () => {
    expect(canManageConnectorConnection({ isOwner: true })).toBe(true);
    expect(canManageConnectorConnection({ isOwner: false })).toBe(false);
  });

  it('never selects token hash columns', () => {
    expect(CONNECTOR_GRANT_METADATA_COLUMNS).not.toMatch(/token_hash/);
    expect(CONNECTOR_GRANT_METADATA_COLUMNS).toContain('scopes');
    expect(CONNECTOR_GRANT_METADATA_COLUMNS).toContain('branch_ids');
    expect(CONNECTOR_GRANT_METADATA_COLUMNS).toContain('expires_at');
  });

  it('projects a metadata-only view with live usability', () => {
    const view = toConnectorConnectionView(makeRow(), NOW);
    expect(view).toMatchObject({
      merchantId: MERCHANT,
      branchIds: [BRANCH],
      merchantWide: false,
      scopes: ['orders:read'],
      status: 'active',
      version: 1,
      expiresAt: null,
      usable: true,
    });
    expect(view).not.toHaveProperty('tokenHash');
    expect(JSON.stringify(view)).not.toMatch(/token/i);
  });

  it('marks expired and revoked grants unusable', () => {
    const expired = toConnectorConnectionView(
      makeRow({ expires_at: '2026-09-30T12:00:00.000Z' }),
      NOW
    );
    expect(expired.usable).toBe(false);

    const revoked = toConnectorConnectionView(
      makeRow({
        status: 'revoked',
        revoked_at: '2026-10-01T11:30:00.000Z',
      }),
      NOW
    );
    expect(revoked.usable).toBe(false);
    expect(revoked.status).toBe('revoked');
  });

  it('mints unique merchant-scoped connection ids', () => {
    const first = newConnectorConnectionId(MERCHANT);
    const second = newConnectorConnectionId(MERCHANT);
    expect(first).toContain(MERCHANT);
    expect(first).not.toBe(second);
  });

  it('issues opaque tokens whose hashes verify without storing secrets', () => {
    const pair = newConnectorTokenPair();
    expect(pair.token).toMatch(/^mcn_[0-9a-f]{64}$/);
    expect(pair.refreshToken).toMatch(/^mcn_refresh_[0-9a-f]{64}$/);
    expect(pair.tokenHash).toBe(
      createHash('sha256').update(pair.token).digest('hex')
    );
    expect(pair.refreshTokenHash).toBe(
      createHash('sha256').update(pair.refreshToken).digest('hex')
    );
    expect(pair.tokenHash).not.toContain(pair.token);
  });

  it('maps RPC denials to the stable error taxonomy', () => {
    expect(
      connectorManagementErrorToHttp('connector_grant_forbidden')
    ).toMatchObject({ status: 403, body: { code: 'FORBIDDEN_SCOPE' } });
    expect(
      connectorManagementErrorToHttp(
        'connector_grant_merchant_wide_requires_owner'
      )
    ).toMatchObject({ status: 403, body: { code: 'FORBIDDEN_SCOPE' } });
    expect(
      connectorManagementErrorToHttp('invalid_connector_grant_branch')
    ).toMatchObject({ status: 403, body: { code: 'FORBIDDEN_SCOPE' } });
    expect(
      connectorManagementErrorToHttp('invalid_connector_grant')
    ).toMatchObject({ status: 400, body: { code: 'INVALID_REQUEST' } });
    const unknown = connectorManagementErrorToHttp('some_pg_internal');
    expect(unknown.status).toBe(500);
    expect(unknown.body.error).not.toContain('some_pg_internal');
  });
  it('reports the connection cap without disclosing a database error', () => {
    expect(
      connectorManagementErrorToHttp('connector_connection_limit')
    ).toMatchObject({ status: 409, body: { code: 'VERSION_CONFLICT' } });
  });
});
