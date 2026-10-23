import {
  builderPublishExecutionSchema,
  builderPublishIntentSchema,
} from '@/schemas/builder-publish-binding';
import type {
  BuilderApprovalVerificationResult,
  BuilderPublishExecution,
  BuilderPublishIntent,
} from './types';
/** A pure model of checks repeated inside publication's atomic transaction, not a bearer proof. */
export function verifyBuilderPublishIntent(
  intent: BuilderPublishIntent,
  execution: BuilderPublishExecution
): BuilderApprovalVerificationResult {
  const now = (execution.now ?? new Date()).getTime();
  const issued = Date.parse(intent.issuedAt);
  const expires = Date.parse(intent.expiresAt);
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(issued) ||
    !Number.isFinite(expires) ||
    issued > now ||
    expires <= now ||
    expires <= issued ||
    expires - issued > 600000
  )
    return { ok: false, code: 'APPROVAL_EXPIRED' };
  if (
    !builderPublishIntentSchema.safeParse(intent).success ||
    !builderPublishExecutionSchema.safeParse(execution).success
  )
    return { ok: false, code: 'APPROVAL_MISMATCH' };
  if (!execution.approverAuthorized)
    return { ok: false, code: 'INSUFFICIENT_SCOPE' };
  if (intent.grantVersion !== execution.grantVersion)
    return { ok: false, code: 'CONNECTION_REVOKED' };
  if (execution.nonceConsumed)
    return { ok: false, code: 'APPROVAL_ALREADY_USED' };
  const fields = [
    'actorUserId',
    'connectionId',
    'storefrontId',
    'draftVersion',
    'destinationUrl',
    'effectDigest',
  ] as const;
  if (fields.some((field) => intent[field] !== execution[field]))
    return { ok: false, code: 'APPROVAL_MISMATCH' };
  return { ok: true, nonce: intent.nonce };
}
