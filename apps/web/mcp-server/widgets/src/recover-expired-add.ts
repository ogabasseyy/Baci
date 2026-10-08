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
 * Throws when a replay cannot complete: the caller merges the returned
 * result as authoritative, so a partial cart would silently drop the
 * unreplayed lines from widget state. The caller keeps local state and
 * shows an error instead, and the next add retries the recovery.
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
  const replayed = await replaySurvivorsIntoCart(
    callCartTool,
    freshToken,
    survivors
  );
  return replayed ?? retry;
}

/**
 * Recovers an add result before the authoritative merge: a stale token
 * retries once without it, and a tokenless mint (expired-cart removal,
 * legacy restore) replays pre-existing local lines into the fresh cart,
 * which otherwise would hold only the new line and drop every survivor
 * from the widget and review URL. Quota, variant-selection, and failure
 * responses carry no token, so they pass through for normal handling.
 */
export async function recoverCartAdd(
  callCartTool: CartUpdateCall,
  result: unknown,
  productId: string,
  quantity: number,
  cartToken: string | undefined,
  cart: CartItem[]
): Promise<unknown> {
  const survivors = cart.filter((item) => item.product.id !== productId);
  if (cartToken) {
    if (
      parseCartToolOutput(readStructuredContent(result))?.cart_expired !== true
    )
      return result;
    return recoverExpiredAdd(callCartTool, productId, quantity, survivors);
  }
  const minted = parseCartToolOutput(readStructuredContent(result));
  const freshToken =
    minted?.success === true ? minted.cart_token : undefined;
  if (!freshToken || survivors.length === 0) return result;
  const replayed = await replaySurvivorsIntoCart(
    callCartTool,
    freshToken,
    survivors
  );
  return replayed ?? result;
}

async function replaySurvivorsIntoCart(
  callCartTool: CartUpdateCall,
  freshToken: string,
  survivors: CartItem[]
): Promise<unknown | null> {
  let result: unknown | null = null;
  for (const survivor of survivors) {
    let response: unknown;
    try {
      response = await callCartTool({
        product_id: survivor.product.id,
        quantity: Math.min(Math.max(survivor.quantity, 1), 10),
        cart_token: freshToken,
      });
    } catch {
      // Transport failure: further replays would fail the same way, and
      // returning the partial cart would drop the unreplayed lines.
      throw new Error('Guest cart recovery did not complete; retry the add.');
    }
    const content = parseCartToolOutput(readStructuredContent(response));
    if (content?.success === true && content.cart_token === freshToken) {
      result = response;
      continue;
    }
    // The fresh cart died mid-replay (evicted under capacity pressure):
    // same incomplete recovery, same failure instead of a partial merge.
    if (content?.cart_expired === true)
      throw new Error('Guest cart recovery did not complete; retry the add.');
    // Only explicitly unrestorable lines are skippable: variant selection
    // needs option choices and a dead product is gone. Every other
    // failure shape (full cart, transient merchant/catalog/filesystem
    // error, unexpected token) is generic, so abort and preserve local
    // state instead of merging a partial cart.
    if (
      content?.success === false &&
      (content.requires_variant_selection === true ||
        content.product_unavailable === true)
    )
      continue;
    throw new Error('Guest cart recovery did not complete; retry the add.');
  }
  return result;
}
