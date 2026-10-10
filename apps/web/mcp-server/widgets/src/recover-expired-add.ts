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

/** A survivor replay skipped as unrestorable: gone, or needs option choices. */
export interface SkippedSurvivor {
  productId: string;
  /** True when the survivor needs option selection; false when the product is gone. */
  requiresVariantSelection: boolean;
}

export interface RecoveredCartAdd {
  /** The tool result for the normal authoritative merge. */
  result: unknown;
  /** Survivors skipped as unrestorable during replay, for the removal notice. */
  skippedSurvivors: SkippedSurvivor[];
}

// Server cart capacity, mirrored from the store/migration 20-line cap:
// the served widget must stay dependency-free, so this cannot be
// imported — keep it in lockstep with guest-cart-store MAX_LINES.
const SERVER_CART_CAPACITY = 20;

/**
 * Recovers an add against an expired or evicted cart: retries once without
 * the stale token so the server mints a fresh cart, then replays the
 * surviving widget lines into it so recovery preserves the shopper's cart
 * instead of dropping every other displayed item. Returns the last usable
 * tool result for the normal merge — the retry result when the retry failed
 * or found variant selection, otherwise the newest successful replay —
 * plus the survivors skipped as unrestorable, so the caller can surface
 * their removal instead of silently dropping them from widget state.
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
): Promise<RecoveredCartAdd> {
  const retry = await callCartTool({
    product_id: productId,
    quantity,
    cart_token: undefined,
  });
  const retryContent = parseCartToolOutput(readStructuredContent(retry));
  const freshToken =
    retryContent?.success === true ? retryContent.cart_token : undefined;
  if (!freshToken || survivors.length === 0)
    return { result: retry, skippedSurvivors: [] };
  const replayed = await replaySurvivorsIntoCart(
    callCartTool,
    freshToken,
    survivors,
    productId
  );
  return {
    result: replayed.result ?? retry,
    skippedSurvivors: replayed.skippedSurvivors,
  };
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
): Promise<RecoveredCartAdd> {
  const survivors = cart.filter((item) => item.product.id !== productId);
  if (cartToken) {
    if (
      parseCartToolOutput(readStructuredContent(result))?.cart_expired !== true
    )
      return { result, skippedSurvivors: [] };
    // Local capacity gate, after the typed-failure passthrough: twenty
    // survivors plus one more line can never fit the server cap, so
    // refuse before minting — minting first would orphan a partial cart
    // and burn a creation-quota slot on every retry, while the shopper
    // only needs to remove a line. (A dead survivor that would have
    // freed a slot resolves the same way: the shopper removes any line
    // and the retry fits.) The gate must not run first: an active
    // token's variant-selection, unavailable, quota, or storage
    // response would be masked as cart_full and its remedy lost. The
    // synthetic result flows into the existing full-cart UX.
    if (survivors.length >= SERVER_CART_CAPACITY) return fullCartRecovery();
    return recoverExpiredAdd(callCartTool, productId, quantity, survivors);
  }
  const minted = parseCartToolOutput(readStructuredContent(result));
  const freshToken =
    minted?.success === true ? minted.cart_token : undefined;
  if (!freshToken || survivors.length === 0)
    return { result, skippedSurvivors: [] };
  // Same gate before replaying into a tokenless mint: the mint holds
  // one line already, so twenty survivors can never fit either. Unlike
  // the expired-token gate above, the caller's initial call already
  // minted this cart, so retire it before reporting full — otherwise
  // every retry orphans another row and burns another creation slot.
  if (survivors.length >= SERVER_CART_CAPACITY) {
    await retirePartialCart(callCartTool, freshToken, [productId]);
    return fullCartRecovery();
  }
  const replayed = await replaySurvivorsIntoCart(
    callCartTool,
    freshToken,
    survivors,
    productId
  );
  return {
    result: replayed.result ?? result,
    skippedSurvivors: replayed.skippedSurvivors,
  };
}

function fullCartRecovery(): RecoveredCartAdd {
  return {
    result: { structuredContent: { success: false, cart_full: true } },
    skippedSurvivors: [],
  };
}

// Best-effort retire of a partial fresh cart: aborts discard the fresh
// token, so without cleanup the row holds products for seven days and
// every retry mints another orphan. Emptying the last line deletes the
// row and retires the token server-side. Cleanup calls are token-bound
// updates, never creation-quota mints — and every failure is swallowed:
// the transport may be down (often why recovery aborted), and the
// recovery error below must survive, never a cleanup error.
async function retirePartialCart(
  callCartTool: CartUpdateCall,
  freshToken: string,
  landedProductIds: string[]
): Promise<void> {
  for (const productId of landedProductIds) {
    try {
      await callCartTool({
        product_id: productId,
        quantity: 0,
        cart_token: freshToken,
      });
    } catch {
      // Abort cleanup on first failure: further calls fail the same way.
      return;
    }
  }
}

async function replaySurvivorsIntoCart(
  callCartTool: CartUpdateCall,
  freshToken: string,
  survivors: CartItem[],
  clickedProductId: string
): Promise<{
  result: unknown | null;
  skippedSurvivors: SkippedSurvivor[];
}> {
  let result: unknown | null = null;
  const skippedSurvivors: SkippedSurvivor[] = [];
  const replayed: string[] = [];
  const abort = async (): Promise<never> => {
    await retirePartialCart(callCartTool, freshToken, [
      clickedProductId,
      ...replayed,
    ]);
    throw new Error('Guest cart recovery did not complete; retry the add.');
  };
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
      await abort();
    }
    const content = parseCartToolOutput(readStructuredContent(response));
    if (content?.success === true && content.cart_token === freshToken) {
      result = response;
      replayed.push(survivor.product.id);
      continue;
    }
    // The fresh cart died mid-replay (evicted under capacity pressure):
    // same incomplete recovery, same failure instead of a partial merge.
    if (content?.cart_expired === true) await abort();
    // Only explicitly unrestorable lines are skippable: variant selection
    // needs option choices and a dead product is gone. Every other
    // failure shape (full cart, transient merchant/catalog/filesystem
    // error, unexpected token) is generic, so abort and preserve local
    // state instead of merging a partial cart. Skips are reported, never
    // silent: the caller merges the result as authoritative, which drops
    // the skipped lines from widget state.
    if (
      content?.success === false &&
      (content.requires_variant_selection === true ||
        content.product_unavailable === true)
    ) {
      skippedSurvivors.push({
        productId: survivor.product.id,
        requiresVariantSelection:
          content.requires_variant_selection === true,
      });
      continue;
    }
    await abort();
  }
  return { result, skippedSurvivors };
}
