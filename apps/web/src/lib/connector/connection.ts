/**
 * Owners-only connector connection helpers (R1).
 *
 * Pure logic behind the merchant Connect/Disconnect interface: owner gating,
 * metadata-only grant views (never token hashes), opaque token issuance, and
 * RPC error mapping for the management routes. Tool-time reads keep using
 * the C-prime flow (`resolve_connector_grant_context` + SET LOCAL ROLE);
 * these management calls run as the owner's own session through RLS plus
 * the grant RPCs, which re-check live membership on every call.
 */

import { createHash, randomBytes } from 'node:crypto';
import {
  type ConnectorErrorBody,
  connectorError,
} from '@/lib/connector/errors';
import { type ConnectorGrant, isGrantUsable } from '@/lib/connector/grant';
import type {
  ConnectorConnectionView,
  ConnectorConnectRequest,
  ConnectorGrantRecord,
} from '@/schemas/connector';

/** Columns a member may read. Token hashes are deliberately absent. */
export const CONNECTOR_GRANT_METADATA_COLUMNS = [
  'id',
  'connection_id',
  'user_id',
  'merchant_id',
  'branch_ids',
  'merchant_wide',
  'scopes',
  'status',
  'version',
  'expires_at',
  'revoked_at',
  'revoke_reason',
  'created_at',
  'updated_at',
  'request_fingerprint',
].join(', ');

function canonicalSet(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

/** Bind a retry to its original shape and absolute expiry without extending it. */
export function connectorRequestFingerprint(
  request: ConnectorConnectRequest,
  expiresAt: string | null
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        merchantId: request.merchantId,
        branchIds: canonicalSet(request.branchIds),
        scopes: canonicalSet(request.scopes),
        merchantWide: request.merchantWide,
        expiresInSeconds: request.expiresInSeconds,
        expiresAt:
          expiresAt === null ? null : new Date(expiresAt).toISOString(),
      })
    )
    .digest('hex');
}

export function connectionMatchesRequest(
  connection: ConnectorConnectionView,
  fingerprint: string | null,
  request: ConnectorConnectRequest
): boolean {
  return (
    fingerprint !== null &&
    fingerprint ===
      connectorRequestFingerprint(request, connection.expiresAt) &&
    connection.merchantId === request.merchantId &&
    connection.merchantWide === request.merchantWide &&
    JSON.stringify(canonicalSet(connection.scopes)) ===
      JSON.stringify(canonicalSet(request.scopes)) &&
    JSON.stringify(canonicalSet(connection.branchIds)) ===
      JSON.stringify(canonicalSet(request.branchIds))
  );
}

export function connectorGrantRecordToGrant(
  row: ConnectorGrantRecord
): ConnectorGrant {
  return {
    id: row.id,
    connectionId: row.connection_id,
    userId: row.user_id,
    merchantId: row.merchant_id,
    branchIds: [...row.branch_ids],
    merchantWide: row.merchant_wide,
    scopes: [...row.scopes],
    status: row.status,
    version: row.version,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}

/** Metadata-only view of a grant row. No credential material survives. */
export function toConnectorConnectionView(
  row: ConnectorGrantRecord,
  now: Date = new Date()
): ConnectorConnectionView {
  const grant = connectorGrantRecordToGrant(row);
  return {
    grantId: grant.id,
    connectionId: grant.connectionId,
    merchantId: grant.merchantId,
    branchIds: grant.branchIds,
    merchantWide: grant.merchantWide,
    scopes: grant.scopes,
    status: grant.status,
    version: grant.version,
    expiresAt: grant.expiresAt,
    usable: isGrantUsable(grant, now),
  };
}

/**
 * Unique connection id per issuance. A revoked row keeps its id, so reuse
 * would collide with the UNIQUE constraint; the random suffix also keeps
 * ids unguessable while staying merchant-prefixed for support triage.
 */
export function newConnectorConnectionId(merchantId: string): string {
  return `muse_${merchantId}_${randomBytes(8).toString('hex')}`;
}

export interface IssuedConnectorTokens {
  token: string;
  tokenHash: string;
  refreshToken: string;
  refreshTokenHash: string;
}

/**
 * Opaque bearer pair. Only the hashes are stored (via the RPC); the raw
 * values are returned to the owner once and must never be logged.
 */
export function newConnectorTokenPair(): IssuedConnectorTokens {
  const token = `mcn_${randomBytes(32).toString('hex')}`;
  const refreshToken = `mcn_refresh_${randomBytes(32).toString('hex')}`;
  return {
    token,
    tokenHash: createHash('sha256').update(token).digest('hex'),
    refreshToken,
    refreshTokenHash: createHash('sha256').update(refreshToken).digest('hex'),
  };
}

export interface ConnectorManagementHttpError {
  status: number;
  body: ConnectorErrorBody;
}

/**
 * Map grant-RPC raise messages to the stable `{ error, code }` taxonomy.
 * Mirrors the harness mapping; no database internals leak to the caller.
 */
export function connectorManagementErrorToHttp(
  message: string
): ConnectorManagementHttpError {
  if (message.includes('connector_connection_limit'))
    return {
      status: 409,
      body: connectorError(
        'VERSION_CONFLICT',
        'Disconnect an existing connection before creating another (limit 50).'
      ),
    };
  if (
    message.includes('connector_grant_forbidden') ||
    message.includes('connector_grant_merchant_wide_requires_owner') ||
    message.includes('invalid_connector_grant_scope') ||
    message.includes('invalid_connector_grant_branch')
  ) {
    return {
      status: 403,
      body: connectorError(
        'FORBIDDEN_SCOPE',
        'Grant request is not permitted for this merchant.'
      ),
    };
  }
  if (
    message.includes('connector_grant_invalid') ||
    message.includes('connector_grant_denied')
  ) {
    return {
      status: 401,
      body: connectorError(
        'GRANT_REVOKED',
        'Connector access is invalid, revoked, or expired.'
      ),
    };
  }
  if (
    message.includes('invalid_connector_grant_token') ||
    message.includes('invalid_connector_grant')
  ) {
    return {
      status: 400,
      body: connectorError('INVALID_REQUEST', 'Grant request is invalid.'),
    };
  }
  return {
    status: 500,
    body: connectorError('UNKNOWN_OUTCOME', 'Connector request failed.'),
  };
}
