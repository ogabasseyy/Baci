import { handleChatwootInlineCartAdd } from '@/components/storefront/ogabassey/components/chat/chatwoot-inline-cart-add';
import { handleChatwootInlineCartQuantity } from '@/components/storefront/ogabassey/components/chat/chatwoot-inline-cart-quantity';
import { buildChatwootInlineReviewResponse } from '@/components/storefront/ogabassey/components/chat/chatwoot-inline-review-response';
import { createClient } from '@/lib/supabase/client';

type QuantityInput = Parameters<typeof handleChatwootInlineCartQuantity>[0];
type AddInput = Parameters<typeof handleChatwootInlineCartAdd>[0];

type SharedInput = Omit<QuantityInput, 'message' | 'post' | 'lineTokens'>;

type MutationMessage =
  | QuantityInput['message']
  | AddInput['message']
  | { event: 'baci-checkout-review-request' };

/** Routes cart quantity, cart add and checkout-review actions. */
export async function dispatchChatwootInlineCartMutation(
  input: SharedInput & {
    lineTokens: QuantityInput['lineTokens'];
    message: MutationMessage;
    requestId: string;
    sessionExpiresAt: number;
    postRaw: (prefix: string, value: unknown) => void;
  }
): Promise<void> {
  const { message, postRaw, requestId, lineTokens, ...shared } = input;
  if (message.event === 'baci-cart-quantity') {
    await handleChatwootInlineCartQuantity({
      ...shared,
      lineTokens,
      message,
      post: (value) => postRaw('baci-cart-quantity-result:', value),
    });
  } else if (message.event === 'baci-cart-add') {
    await handleChatwootInlineCartAdd({
      ...shared,
      message,
      post: (value) => postRaw('baci-cart-add-result:', value),
    });
  } else if (message.event === 'baci-checkout-review-request') {
    const review = buildChatwootInlineReviewResponse(
      requestId,
      shared.snapshot,
      // The review builder takes epoch seconds; the bridge tracks milliseconds.
      Math.floor(shared.sessionExpiresAt / 1000)
    );
    if (review.paySmallSmallAvailable) {
      const signedIn = await createClient()
        .auth.getUser()
        .then(({ data, error }) => !error && Boolean(data.user))
        .catch(() => false);
      postRaw('baci-checkout-review:', { ...review, signedIn });
    } else {
      postRaw('baci-checkout-review:', review);
    }
  }
}
