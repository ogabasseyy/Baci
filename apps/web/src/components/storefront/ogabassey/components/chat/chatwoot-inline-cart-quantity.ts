import { postChatwootBridgeJson } from './chatwoot-bridge-request';
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
    message.data.cartVersion > input.snapshot.cartVersion ||
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
    mutation = await postChatwootBridgeJson(
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
      input.storeSlug
    );
  } catch {
    mutation = null;
  }

  // The mutation route commits through the canonical service directly, so
  // Refresh the storefront's serialized shared-cart client after a commit
  // whenever this same authorized context remains current. A later action can
  // supersede the reply while this mutation still commits successfully.
  const refreshRequired = mutation?.code === 'refresh_required';
  if (
    mutation?.accepted === true &&
    input.isCurrentContext() &&
    typeof mutation.sessionToken === 'string' &&
    mutation.sessionToken.length > 0 &&
    mutation.sessionToken.length <= 12_000
  ) {
    input.onSessionTokenRenewed?.(mutation.sessionToken);
  }
  if (
    (mutation?.accepted === true || refreshRequired || mutation === null) &&
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
    accepted: mutation?.accepted === true,
    ...(mutation?.accepted === true
      ? {}
      : {
          code:
            mutation?.code === 'refresh_required' ||
            mutation?.code === 'forbidden' ||
            mutation?.code === 'invalid_request'
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
