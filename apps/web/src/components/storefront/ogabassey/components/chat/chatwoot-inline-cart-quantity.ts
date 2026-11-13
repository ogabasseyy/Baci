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
  isCurrent: () => boolean;
  lineTokens: Map<string, string>;
  message: QuantityMessage;
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
    input.post({ requestId, accepted: false });
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
  // refresh the storefront's serialized shared-cart client before reporting
  // success. Do not refresh after this action has been invalidated.
  if (mutation?.accepted === true && input.isCurrent()) {
    try {
      await input.refreshSharedCart?.();
    } catch {
      // The server commit is authoritative; leave the action outcome intact.
    }
  }
  if (!input.isCurrent() || input.sessionExpiresAt <= Date.now()) return;
  input.post({
    requestId,
    accepted: mutation?.accepted === true,
    ...(typeof mutation?.cartVersion === 'number'
      ? { cartVersion: mutation.cartVersion }
      : {}),
  });
}
