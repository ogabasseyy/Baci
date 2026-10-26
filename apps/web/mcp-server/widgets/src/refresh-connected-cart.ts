import { parseConnectedCartReply } from './connected-cart-reply';
import { readStructuredContent } from './parse-cart-tool-output';

/** Refresh state without replaying any stale write or legacy cached items. */
export async function refreshConnectedCart(
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>,
  expectedCartId?: string,
) {
  const reply = parseConnectedCartReply(readStructuredContent(await callTool('get_ogabassey_guest_cart', {})));
  if (!reply || (expectedCartId && reply.cartId !== expectedCartId)) throw new Error('Connected cart unavailable');
  return reply;
}
