import { TOOL_REQUIREMENTS } from './tool-requirements';
/**
 * Connector authorization resolver (R0 spike).
 *
 * Pure gateway logic: intersects requested scope, grant scope, live role
 * permission, and the branch allowlist on every call. Tool arguments such as
 * `merchant_id` / `branch_id` are resource selectors only and must be
 * contained by the resolved grant — they are never proof of authority.
 *
 * Live access must come from the existing path (`get_user_access` /
 * `getMerchantForApiRequest` + `hasPermission`); role claims embedded in a
 * token are never trusted.
 */

import { hasPermission, type UserAccess } from '@/lib/api-permissions';
import {
  type ConnectorErrorBody,
  connectorError,
} from '@/lib/connector/errors';
import {
  type ConnectorGrant,
  grantHasScope,
  isGrantUnexpired,
} from '@/lib/connector/grant';
import {
  type ConnectorToolName,
  getConnectorTool,
} from '@/lib/connector/manifest';

/** Decision-rules version recorded on every authorization for audit. */
export const CONNECTOR_POLICY_VERSION = 1;

export interface ConnectorAuthorizationInput {
  grant: ConnectorGrant;
  /** Live access re-evaluated for this call; null when the user has none. */
  liveAccess: UserAccess | null;
  /** False when the Baci user was suspended or removed. */
  userActive: boolean;
  tool: ConnectorToolName;
  /** Resource selectors from tool arguments (never authority). */
  requestedMerchantId?: string | null;
  requestedBranchIds?: string[];
  /** Optimistic concurrency: rejects stale grant snapshots. */
  expectedGrantVersion?: number;
  now?: Date;
}

export interface ConnectorAuthorizationContext {
  userId: string;
  merchantId: string;
  /**
   * Effective branch set for the call. `null` means merchant-wide access
   * (owner or merchant-authorized role only); otherwise the intersected
   * allowlist. Downstream queries must scope to this set.
   */
  branchIds: string[] | null;
  grantId: string;
  grantVersion: number;
  policyVersion: number;
}

export type ConnectorAuthorizationResult =
  | { ok: true; context: ConnectorAuthorizationContext }
  | { ok: false; body: ConnectorErrorBody };

function deny(body: ConnectorErrorBody): ConnectorAuthorizationResult {
  return { ok: false, body };
}

export function resolveConnectorAuthorization(
  input: ConnectorAuthorizationInput
): ConnectorAuthorizationResult {
  const { grant, liveAccess, userActive } = input;
  const now = input.now ?? new Date();

  if (grant.status === 'revoked' || grant.revokedAt !== null) {
    return deny(
      connectorError(
        'GRANT_REVOKED',
        'Connector access was revoked. Reconnect to continue.'
      )
    );
  }
  if (grant.status === 'expired' || !isGrantUnexpired(grant, now)) {
    return deny(
      connectorError(
        'GRANT_EXPIRED',
        'Connector access expired. Reconnect to continue.'
      )
    );
  }
  if (grant.status !== 'active') {
    return deny(
      connectorError('FORBIDDEN_SCOPE', 'Connector grant is not active.')
    );
  }
  if (!userActive) {
    return deny(
      connectorError(
        'USER_SUSPENDED',
        'The linked Baci user is no longer active.'
      )
    );
  }
  if (liveAccess === null) {
    return deny(
      connectorError(
        'ROLE_REMOVED',
        'No live merchant access for the linked user.'
      )
    );
  }
  if (liveAccess.merchantId !== grant.merchantId) {
    return deny(
      connectorError(
        'FORBIDDEN_SCOPE',
        'Connector grant does not cover this merchant.'
      )
    );
  }
  if (
    input.requestedMerchantId !== undefined &&
    input.requestedMerchantId !== null &&
    input.requestedMerchantId !== grant.merchantId
  ) {
    return deny(
      connectorError(
        'FORBIDDEN_SCOPE',
        'Requested merchant is outside the connector grant.'
      )
    );
  }
  if (
    input.expectedGrantVersion !== undefined &&
    input.expectedGrantVersion !== grant.version
  ) {
    return deny(
      connectorError(
        'VERSION_CONFLICT',
        'Grant changed since it was read. Re-resolve and retry.'
      )
    );
  }

  const requirement = TOOL_REQUIREMENTS[input.tool];
  const manifestScope = getConnectorTool(input.tool)?.requiredScope;
  if (manifestScope === undefined) {
    return deny(connectorError('FORBIDDEN_SCOPE', 'Unknown connector tool.'));
  }
  if (!hasPermission(liveAccess, requirement.resource, requirement.action)) {
    return deny(
      connectorError(
        'ROLE_REMOVED',
        'The linked user lost permission for this operation.'
      )
    );
  }
  if (!grantHasScope(grant, manifestScope)) {
    return deny(
      connectorError(
        'FORBIDDEN_SCOPE',
        'Connector grant does not include the required scope.'
      )
    );
  }

  // Merchant-wide access only when the live role already grants it.
  // Owner labels alone are not enough unless the authorization layer maps
  // them: here that mapping is the owner's full-access permission set.
  const merchantWideAllowed = grant.merchantWide && liveAccess.isOwner;
  if (grant.merchantWide && !liveAccess.isOwner) {
    return deny(
      connectorError(
        'FORBIDDEN_SCOPE',
        'Merchant-wide connector access requires merchant-level authority.'
      )
    );
  }

  // An empty selector list is the same as no selector: the grant's
  // applicable allowlist applies. Only non-empty selectors narrow.
  const requested =
    input.requestedBranchIds !== undefined &&
    input.requestedBranchIds.length > 0
      ? input.requestedBranchIds
      : null;
  if (requested !== null) {
    const allowlist = merchantWideAllowed ? null : grant.branchIds;
    const outside =
      allowlist === null
        ? []
        : requested.filter((id) => !allowlist.includes(id));
    if (outside.length > 0) {
      return deny(
        connectorError(
          'BRANCH_NOT_ALLOWED',
          'Requested branch is outside the connector grant.'
        )
      );
    }
    return {
      ok: true,
      context: {
        userId: grant.userId,
        merchantId: grant.merchantId,
        branchIds: requested,
        grantId: grant.id,
        grantVersion: grant.version,
        policyVersion: CONNECTOR_POLICY_VERSION,
      },
    };
  }

  return {
    ok: true,
    context: {
      userId: grant.userId,
      merchantId: grant.merchantId,
      branchIds: merchantWideAllowed ? null : [...grant.branchIds],
      grantId: grant.id,
      grantVersion: grant.version,
      policyVersion: CONNECTOR_POLICY_VERSION,
    },
  };
}
