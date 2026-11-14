import { postChatwootBridgeJson } from './chatwoot-bridge-request';
import { runCartSessionCookieWrite } from '@/hooks/cart/cart-session-cookie-write';
import type { chatwootCommerceMessageSchema } from '@/schemas/chatwoot-commerce-message';
import type { chatwootCartReviewSnapshotSchema } from '@/schemas/chatwoot-cart-review-snapshot';
import type { z } from 'zod';

type QuantityMessage = Extract<
  z.infer<typeof chatwootCommerceMessageSchema>,
  { event: 'baci-cart-quantity' }
>;

export async function handleChatwootInlineCartQuantity(input: {
  conversationId: number;
  isCurrentAction: () => boolean;
  isCurrentCartContext: () => boolean;
  isCurrentContext: () => boolean;
  lineTokens: Map<string, string>;
  message: QuantityMessage;
  onSessionTokenRenewed?: (sessionToken: string) => void;
  post: (value: unknown) => void;
  refreshSharedCart?: () => Promise<void>;
  sessionExpiresAt: number;
  sessionToken: string;
  snapshot: z.infer<typeof chatwootCartReviewSnapshotSchema>;
  storeSlug: string;
}) {
  const { message } = input;
  const { requestId } = message.data;
  const lineId = input.lineTokens.get(message.data.lineToken);
  const reviewedLine = input.snapshot.items.find(
    (item) => item.lineId === lineId
  );
  if (
    !lineId ||
    (message.data.cartVersion === input.snapshot.cartVersion &&
      (!reviewedLine ||
        reviewedLine.quantity !== message.data.expectedQuantity))
  ) {
    if (input.isCurrentContext()) {
      try {
        await input.refreshSharedCart?.();
      } catch {
        // The local snapshot is stale; keep the action rejected.
      }
    }
    if (!input.isCurrentAction() || input.sessionExpiresAt <= Date.now()) return;
    input.post({ requestId, accepted: false, code: 'refresh_required' });
    return;
  }

  let mutation: Record<string, unknown> | null;
  try {
    mutation = await runCartSessionCookieWrite(
      input.storeSlug,
      null,
      (signal) =>
        postChatwootBridgeJson(
          '/api/storefront/chatwoot/cart/quantity',
          {
            cartVersion: message.data.cartVersion,
            conversationId: input.conversationId,
            expectedQuantity: message.data.expectedQuantity,
            lineId,
            quantity: message.data.quantity,
            requestId,
            sessionToken: input.sessionToken,
          },
          input.storeSlug,
          signal,
          { allowNonOkResponse: true }
        )
    );
  } catch {
    mutation = null;
  }

  // The mutation route commits through the canonical service directly, so
  // Refresh the storefront's serialized shared-cart client after a commit
  // whenever this same authorized context remains current. A later action can
  // supersede the reply while this mutation still commits successfully.
  const refreshRequired = mutation?.code === 'refresh_required';
  const cartExpired = mutation?.code === 'cart_expired';
  const accepted =
    mutation?.accepted === true && mutation.operationId === requestId;
  const acceptedResponseMismatch =
    mutation?.accepted === true && mutation.operationId !== requestId;
  const outcomeUnavailable =
    mutation === null ||
    acceptedResponseMismatch ||
    (typeof mutation?.httpStatus === 'number' &&
      Number.isSafeInteger(mutation.httpStatus));
  if (
    accepted &&
    mutation !== null &&
    input.isCurrentContext() &&
    typeof mutation.sessionToken === 'string' &&
    mutation.sessionToken.length > 0 &&
    mutation.sessionToken.length <= 12_000
  ) {
    input.onSessionTokenRenewed?.(mutation.sessionToken);
  }
  if (
    (accepted ||
      refreshRequired ||
      (outcomeUnavailable && !cartExpired)) &&
    input.isCurrentCartContext()
  ) {
    try {
      await input.refreshSharedCart?.();
    } catch {
      // The server commit is authoritative; leave the action outcome intact.
    }
  }
  if (!input.isCurrentAction() || input.sessionExpiresAt <= Date.now()) return;
  input.post({
    requestId,
    accepted,
    ...(accepted
      ? {}
      : {
          code:
            mutation?.code === 'refresh_required' ||
            mutation?.code === 'invalid_context' ||
            mutation?.code === 'forbidden' ||
            mutation?.code === 'invalid_request' ||
            mutation?.code === 'quota_exceeded' ||
            mutation?.code === 'cart_expired'
              ? mutation.code
              : 'temporarily_unavailable',
        }),
    ...(typeof mutation?.cartVersion === 'number' &&
    Number.isSafeInteger(mutation.cartVersion) &&
    mutation.cartVersion >= input.snapshot.cartVersion
      ? { cartVersion: mutation.cartVersion }
      : {}),
  });
}
