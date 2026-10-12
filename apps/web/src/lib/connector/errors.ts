/**
 * Stable connector error codes (R0 spike).
 *
 * Codes drive the caller's next action: Muse must be able to explain a
 * denial without guessing. Shapes follow the repository API contract
 * `{ error: string, code?: string }` with no raw provider/database detail.
 */

export const CONNECTOR_ERROR_CODES = [
  'FORBIDDEN_SCOPE',
  'BRANCH_NOT_ALLOWED',
  'GRANT_REVOKED',
  'GRANT_EXPIRED',
  'USER_SUSPENDED',
  'ROLE_REMOVED',
  'VERSION_CONFLICT',
  'INVALID_TRANSITION',
  'APPROVAL_REQUIRED',
  'APPROVAL_EXPIRED',
  'APPROVAL_ALREADY_USED',
  'CURSOR_EXPIRED',
  'UNKNOWN_OUTCOME',
  'IDEMPOTENCY_KEY_REUSED',
  'INVALID_REQUEST',
  'RATE_LIMITED',
  'TOOL_UNAVAILABLE',
] as const;

export type ConnectorErrorCode = (typeof CONNECTOR_ERROR_CODES)[number];

export interface ConnectorErrorBody {
  error: string;
  code: ConnectorErrorCode;
}

export function connectorError(
  code: ConnectorErrorCode,
  message: string
): ConnectorErrorBody {
  return { error: message, code };
}

const CONNECTOR_ERROR_STATUS: Record<ConnectorErrorCode, number> = {
  FORBIDDEN_SCOPE: 403,
  BRANCH_NOT_ALLOWED: 403,
  GRANT_REVOKED: 401,
  GRANT_EXPIRED: 401,
  USER_SUSPENDED: 403,
  ROLE_REMOVED: 403,
  VERSION_CONFLICT: 409,
  INVALID_TRANSITION: 422,
  APPROVAL_REQUIRED: 403,
  APPROVAL_EXPIRED: 410,
  APPROVAL_ALREADY_USED: 409,
  CURSOR_EXPIRED: 410,
  UNKNOWN_OUTCOME: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  INVALID_REQUEST: 400,
  RATE_LIMITED: 429,
  TOOL_UNAVAILABLE: 501,
};

export function connectorErrorStatus(code: ConnectorErrorCode): number {
  return CONNECTOR_ERROR_STATUS[code];
}
