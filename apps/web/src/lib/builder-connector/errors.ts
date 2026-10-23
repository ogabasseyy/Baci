import {
  BUILDER_EDITOR_URL,
  builderRevisionSchema,
} from '@/schemas/builder-mcp-primitives';
export const BUILDER_ERROR_MESSAGES = {
  APPROVAL_EXPIRED:
    'This approval expired. Request a new publication approval.',
  APPROVAL_ALREADY_USED:
    'This approval has already been used. Read the publication receipt.',
  APPROVAL_MISMATCH:
    'The publication approval does not match this revision or destination.',
  PREVIEW_REQUIRED:
    'A safe preview of this exact revision is required before publication.',

  RATE_LIMITED: 'Too many requests. Wait briefly before retrying.',
  INVALID_REQUEST: 'The request is invalid.',
  NOT_FOUND: 'Storefront not found.',
  STALE_DRAFT: 'The draft changed. Read the current revision and try again.',
  IDEMPOTENCY_CONFLICT: 'This retry key was used for a different change.',
  CONNECTION_REVOKED: 'Reconnect your Baci account to continue.',
  INSUFFICIENT_SCOPE: 'Authorize the required Baci permissions to continue.',
  STORE_ALREADY_EXISTS:
    'This account already has a store. Select it to continue.',
  UNSUPPORTED_TEMPLATE: 'This storefront requires the Baci editor.',
  UNSUPPORTED_PAGE: 'Only the homepage is supported by this integration.',
  SLUG_UNAVAILABLE: 'That store address is unavailable. Choose another.',
  SLUG_IMMUTABLE: 'An established store URL cannot be changed here.',
  PUBLISH_BLOCKED: 'Complete the launch requirements before publishing.',
  APPROVAL_REQUIRED: 'Approve this exact publication in Baci.',
  OPERATION_FAILED:
    'The operation could not be completed. Read its status before retrying.',
} as const;
export type BuilderErrorCode = keyof typeof BUILDER_ERROR_MESSAGES;
/** No provider error/message is accepted by this public-error factory. */
export function builderError(
  code: 'STALE_DRAFT',
  currentVersion: string
): {
  status: 'error';
  code: 'STALE_DRAFT';
  error: string;
  currentVersion: string;
};
export function builderError(code: Exclude<BuilderErrorCode, 'STALE_DRAFT'>): {
  status: 'error';
  code: Exclude<BuilderErrorCode, 'STALE_DRAFT'>;
  error: string;
  editorUrl?: typeof BUILDER_EDITOR_URL;
};
export function builderError(
  code: BuilderErrorCode,
  currentVersion?: string
): {
  status: 'error';
  code: BuilderErrorCode;
  error: string;
  currentVersion?: string;
  editorUrl?: typeof BUILDER_EDITOR_URL;
} {
  const base = {
    status: 'error' as const,
    code,
    error: BUILDER_ERROR_MESSAGES[code],
  };
  if (code === 'STALE_DRAFT')
    return {
      ...base,
      currentVersion: builderRevisionSchema.parse(currentVersion),
    };
  return code === 'UNSUPPORTED_TEMPLATE'
    ? { ...base, editorUrl: BUILDER_EDITOR_URL }
    : base;
}
