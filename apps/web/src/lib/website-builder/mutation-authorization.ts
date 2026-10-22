import {
  type BuilderErrorCode,
  builderError,
} from '@/lib/builder-connector/errors';
import type {
  BuilderIdentity,
  BuilderScope,
} from '@/lib/builder-connector/types';
/** Early rejection only; every business RPC repeats canonical authorization under a row lock. */
export function requireBuilderScope(
  identity: BuilderIdentity,
  scope: BuilderScope
) {
  if (!identity.scopes.has(scope))
    throw new DraftServiceError('INSUFFICIENT_SCOPE');
}
export class DraftServiceError extends Error {
  constructor(readonly code: Exclude<BuilderErrorCode, 'STALE_DRAFT'>) {
    super(builderError(code).error);
  }
}
export function safeDatabaseFailure(error: {
  code?: string;
  message?: string;
}): never {
  const allowed = [
    'APPROVAL_EXPIRED',
    'APPROVAL_ALREADY_USED',
    'APPROVAL_MISMATCH',
    'PREVIEW_REQUIRED',
    'CONNECTION_REVOKED',
    'INSUFFICIENT_SCOPE',
    'NOT_FOUND',
    'IDEMPOTENCY_CONFLICT',
    'STORE_ALREADY_EXISTS',
    'SLUG_IMMUTABLE',
    'SLUG_UNAVAILABLE',
    'UNSUPPORTED_TEMPLATE',
    'INVALID_REQUEST',
  ] as const;
  const code = allowed.find((value) => error.message === value);
  // No SQL detail, provider messages, config or tenant identity crosses this boundary.
  throw new DraftServiceError(code ?? 'OPERATION_FAILED');
}
