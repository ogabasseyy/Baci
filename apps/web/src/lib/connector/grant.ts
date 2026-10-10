/**
 * Connector grant model (R0 spike).
 *
 * A grant is a delegation, not a staff identity and not a tenant bypass.
 * Every connector call resolves through the same user, staff-permission and
 * row-level security rules as the application. Mirrors the
 * `public.connector_grants` table; see the R0 design doc.
 */

export const CONNECTOR_GRANT_STATUSES = [
  'active',
  'revoked',
  'expired',
] as const;

export type ConnectorGrantStatus = (typeof CONNECTOR_GRANT_STATUSES)[number];

/**
 * R0 read scopes only. Write scopes are deliberately absent: no fulfillment,
 * cancellation, refund, inventory, or outreach capability exists until its
 * release gate passes.
 */
export const CONNECTOR_SCOPES = [
  'orders:read',
  'inventory:read',
  'analytics:read',
  'events:read',
] as const;

export type ConnectorScope = (typeof CONNECTOR_SCOPES)[number];

export interface ConnectorGrant {
  id: string;
  connectionId: string;
  userId: string;
  merchantId: string;
  /**
   * Explicit branch allowlist. Empty means no branch access, never "all".
   * Merchant-wide access is expressed only via `merchantWide`, which is
   * honored solely when the live Baci role grants merchant-level authority.
   */
  branchIds: string[];
  merchantWide: boolean;
  scopes: ConnectorScope[];
  status: ConnectorGrantStatus;
  /** Bumped on any permission-affecting change; stale versions are rejected. */
  version: number;
  expiresAt: string | null;
  revokedAt: string | null;
}

export function isConnectorScope(value: string): value is ConnectorScope {
  return (CONNECTOR_SCOPES as readonly string[]).includes(value);
}

/** Deny by default: only explicitly granted scopes pass. */
export function grantHasScope(
  grant: ConnectorGrant,
  scope: ConnectorScope
): boolean {
  return grant.scopes.includes(scope);
}

export function isGrantUnexpired(
  grant: ConnectorGrant,
  now: Date = new Date()
): boolean {
  if (grant.expiresAt === null) return true;
  return new Date(grant.expiresAt).getTime() > now.getTime();
}

export function isGrantUsable(
  grant: ConnectorGrant,
  now: Date = new Date()
): boolean {
  return grant.status === 'active' && isGrantUnexpired(grant, now);
}
