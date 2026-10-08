import {
  parseCartToolOutput,
  readStructuredContent,
} from './parse-cart-tool-output';
import type { CartItem } from './widget-types';

export interface CartUpdateCall {
  (args: {
    product_id: string;
    quantity: number;
    cart_token?: string;
  }): Promise<unknown>;
}

/**
 * Recovers an add against an expired or evicted cart: retries once without
 * the stale token so the server mints a fresh cart, then replays the
 * surviving widget lines into it so recovery preserves the shopper's cart
 * instead of dropping every other displayed item. Returns the last usable
 * tool result for the normal merge: the retry result when the retry failed
 * or found variant selection, otherwise the newest successful replay.
 */
export async function recoverExpiredAdd(
  callCartTool: CartUpdateCall,
  productId: string,
  quantity: number,
  survivors: CartItem[]
): Promise<unknown> {
  const retry = await callCartTool({
    product_id: productId,
    quantity,
    cart_token: undefined,
  });
  const retryContent = parseCartToolOutput(readStructuredContent(retry));
  const freshToken =
    retryContent?.success === true ? retryContent.cart_token : undefined;
  if (!freshToken || survivors.length === 0) return retry;
  let result: unknown = retry;
  for (const survivor of survivors) {
    let response: unknown;
    try {
      response = await callCartTool({
        product_id: survivor.product.id,
        quantity: Math.min(Math.max(survivor.quantity, 1), 10),
        cart_token: freshToken,
      });
    } catch {
      // Transport failure: further replays would fail the same way, so keep
      // the last good result instead of hanging the recovery.
      break;
    }
    const content = parseCartToolOutput(readStructuredContent(response));
    if (content?.success === true && content.cart_token === freshToken) {
      result = response;
      continue;
    }
    if (content?.cart_expired === true) break;
    // Stale survivor (catalog validation failed, variant selection required,
    // or an unexpected token): skip it and keep the last good result.
  }
  return result;
}
