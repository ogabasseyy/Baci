import { postChatwootBridgeJson } from './chatwoot-bridge-request';
import { runCartSessionCookieWrite } from '@/hooks/cart/cart-session-cookie-write';
import type { chatwootCommerceMessageSchema } from '@/schemas/chatwoot-commerce-message';
import type { chatwootCartReviewSnapshotSchema } from '@/schemas/chatwoot-cart-review-snapshot';
import type { z } from 'zod';

type AddMessage = Extract<
  z.infer<typeof chatwootCommerceMessageSchema>,
  { event: 'baci-cart-add' }
>;

export async function handleChatwootInlineCartAdd(input: {
  conversationId: number;
  isCurrentAction: () => boolean;
  isCurrentCartContext: () => boolean;
  isCurrentContext: () => boolean;
  message: AddMessage;
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
  if (
    !input.isCurrentAction() ||
    !input.isCurrentContext() ||
    input.sessionExpiresAt <= Date.now()
  ) {
    if (input.isCurrentAction()) {
      input.post({ requestId, accepted: false, code: 'invalid_context' });
    }
    return;
  }
  let mutation: Record<string, unknown> | null;
  try {
    mutation = await runCartSessionCookieWrite(
      input.storeSlug,
      null,
      (signal) =>
        postChatwootBridgeJson(
          '/api/storefront/chatwoot/cart/add',
          {
            cartVersion: input.snapshot.cartVersion,
            conversationId: input.conversationId,
            productSlug: message.data.slug,
            requestId,
            sessionToken: input.sessionToken,
            ...(message.data.variantId
              ? { variantId: message.data.variantId }
              : null),
          },
          input.storeSlug,
          signal,
          { allowNonOkResponse: true }
        )
    );
  } catch {
    mutation = null;
  }

  const accepted =
    mutation?.accepted === true && mutation.operationId === requestId;
  const acceptedResponseMismatch =
    mutation?.accepted === true && mutation.operationId !== requestId;
  const refreshRequired = mutation?.code === 'refresh_required';
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
    (accepted || refreshRequired || outcomeUnavailable) &&
    input.isCurrentCartContext()
  ) {
    try {
      await input.refreshSharedCart?.();
    } catch {
      // The server commit remains authoritative; leave the result unchanged.
    }
  }
  if (!input.isCurrentAction() || input.sessionExpiresAt <= Date.now()) return;
  input.post({
    requestId,
    accepted,
    ...(accepted
      ? {
          ...(typeof mutation?.cartVersion === 'number'
            ? { cartVersion: mutation.cartVersion }
            : null),
          ...(mutation?.replayed === true ? { replayed: true } : null),
        }
      : {
          code:
            typeof mutation?.code === 'string'
              ? mutation.code
              : 'temporarily_unavailable',
        }),
  });
}
