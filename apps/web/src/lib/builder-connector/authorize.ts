import { BUILDER_POLICY_VERSION } from '@/schemas/builder-mcp-primitives';
import { type BuilderErrorCode, builderError } from './errors';
import { builderToolPolicy, getBuilderCapabilities } from './tool-policy';
import type {
  BuilderIdentity,
  BuilderLiveOwner,
  BuilderToolName,
} from './types';

const deny = (code: Exclude<BuilderErrorCode, 'STALE_DRAFT'>) => ({
  ok: false as const,
  error: builderError(code),
});
/** Pure preflight only; mutations must re-lock the canonical grant in their transaction. */
export function authorizeBuilderOperation(
  identity: BuilderIdentity,
  liveOwner: BuilderLiveOwner,
  operation: BuilderToolName,
  merchantId?: string
) {
  const live = liveOwner.connection;
  const now = (liveOwner.now ?? new Date()).getTime();
  if (
    !Number.isFinite(now) ||
    !liveOwner.userActive ||
    identity.actorUserId !== liveOwner.actorUserId ||
    live.actorUserId !== identity.actorUserId ||
    live.connectionId !== identity.connectionId ||
    live.grantVersion !== identity.grantVersion ||
    !Number.isSafeInteger(live.grantVersion) ||
    live.grantVersion < 1 ||
    live.status !== 'active' ||
    live.revokedAt !== null ||
    (live.expiresAt !== null && !(Date.parse(live.expiresAt) > now))
  )
    return deny('CONNECTION_REVOKED');
  if (!Object.hasOwn(builderToolPolicy, operation))
    return deny('INVALID_REQUEST');
  const policy = builderToolPolicy[operation];
  if (
    policy.scopes.some(
      (scope) => !identity.scopes.has(scope) || !live.scopes.has(scope)
    )
  )
    return deny('INSUFFICIENT_SCOPE');
  const success = (selected: string | null) => ({
    ok: true as const,
    context: {
      actorUserId: identity.actorUserId,
      connectionId: identity.connectionId,
      grantVersion: live.grantVersion,
      merchantId: selected,
      scopes: [...policy.scopes],
      policyVersion: BUILDER_POLICY_VERSION,
    },
  });
  if (merchantId !== undefined && merchantId !== liveOwner.merchantId)
    return deny('NOT_FOUND');
  if (liveOwner.merchantId !== null && !liveOwner.isOwner)
    return deny('NOT_FOUND');
  if (operation === 'create_storefront_draft') {
    if (!identity.allowCreateStore || !live.allowCreateStore)
      return deny('INSUFFICIENT_SCOPE');
    if (liveOwner.storeState === 'established')
      return deny('STORE_ALREADY_EXISTS');
    return success(liveOwner.merchantId);
  }
  const selected = liveOwner.merchantId;
  const consented =
    selected !== null &&
    identity.allowedMerchantIds.includes(selected) &&
    live.allowedMerchantIds.includes(selected);
  if (operation === 'list_storefronts')
    return success(consented ? selected : null);
  if (!consented) return deny('NOT_FOUND');
  if (
    [
      'update_storefront_draft',
      'apply_storefront_operation',
      'preview_storefront',
      'publish_storefront',
    ].includes(operation) &&
    !getBuilderCapabilities(liveOwner.templateId, liveOwner.rendererVersion)
      .supported
  )
    return deny('UNSUPPORTED_TEMPLATE');
  return success(selected);
}
export type AuthorizationResult = ReturnType<typeof authorizeBuilderOperation>;
