import { connectorError } from '../../src/lib/connector/errors';
import type { HarnessHttpError } from './gateway-types';
export function pgRaiseToHttp(message: string): HarnessHttpError {
  switch (message) {
    case 'connector_grant_invalid':
    case 'connector_grant_denied':
      return {
        status: 401,
        body: connectorError(
          'GRANT_REVOKED',
          'Connector access is invalid, revoked, or expired.'
        ),
      };
    case 'connector_user_suspended':
      return {
        status: 403,
        body: connectorError(
          'USER_SUSPENDED',
          'The linked Baci account is inactive.'
        ),
      };
    case 'connector_grant_forbidden':
      return {
        status: 403,
        body: connectorError(
          'ROLE_REMOVED',
          'The linked Baci user is no longer authorized for this merchant.'
        ),
      };
    case 'connector_scope_denied':
      return {
        status: 403,
        body: connectorError(
          'FORBIDDEN_SCOPE',
          'Connector grant does not include the required scope.'
        ),
      };
    case 'connector_branch_denied':
      return {
        status: 403,
        body: connectorError(
          'BRANCH_NOT_ALLOWED',
          'Requested branch is outside the connector grant.'
        ),
      };
    case 'invalid_connector_grant_scope':
    case 'invalid_connector_grant_branch':
    case 'connector_grant_merchant_wide_requires_owner':
      return {
        status: 403,
        body: connectorError(
          'FORBIDDEN_SCOPE',
          'Grant request is not permitted.'
        ),
      };
    case 'invalid_connector_grant':
    case 'invalid_connector_grant_token':
      return {
        status: 400,
        body: connectorError('INVALID_REQUEST', 'Grant request is invalid.'),
      };
    default:
      return {
        status: 500,
        body: connectorError('UNKNOWN_OUTCOME', 'Connector request failed.'),
      };
  }
}

export function pgErrorToHttp(error: unknown): HarnessHttpError {
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string'
  ) {
    return pgRaiseToHttp((error as { message: string }).message);
  }
  return pgRaiseToHttp('__unknown__');
}
