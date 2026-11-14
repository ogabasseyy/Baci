import { chatwootCartReviewSnapshotSchema } from '@/schemas/chatwoot-cart-review-snapshot';
import { postChatwootBridgeJson } from './chatwoot-bridge-request';

export async function authorizeChatwootBridgeSession(
  sessionToken: string,
  storeSlug: string
) {
  if (!sessionToken || sessionToken.length > 12_000) return null;
  const value = await postChatwootBridgeJson(
    '/api/storefront/chatwoot/context/authorize',
    { sessionToken, includeCartSnapshot: true },
    storeSlug
  );
  if (!value) return null;
  const snapshot = chatwootCartReviewSnapshotSchema.safeParse(
    value.cartSnapshot
  );
  if (
    value.authorized !== true ||
    typeof value.conversationId !== 'number' ||
    !Number.isSafeInteger(value.conversationId) ||
    typeof value.sessionExpiresAt !== 'number' ||
    !Number.isSafeInteger(value.sessionExpiresAt) ||
    value.sessionExpiresAt * 1000 <= Date.now() ||
    !snapshot.success
  ) {
    return null;
  }
  return {
    conversationId: value.conversationId,
    sessionExpiresAt: value.sessionExpiresAt,
    snapshot: snapshot.data,
    ...(typeof value.sessionToken === 'string' &&
    value.sessionToken.length > 0 &&
    value.sessionToken.length <= 12_000
      ? { sessionToken: value.sessionToken }
      : {}),
  };
}
