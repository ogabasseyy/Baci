import { parseHandoffLines, type HandoffLine } from './parse-handoff-lines';
import type { Product, WidgetState } from './widget-types';

const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
export interface ConnectedCartReply {
  cartId: string;
  version: number;
  url: string;
  items: HandoffLine[];
}
/** Syntax only: the receiving website verifies the signed handoff. */
export function connectedCartReviewUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    const fragment = new URLSearchParams(url.hash.slice(1));
    if (
      url.origin !== 'https://ogabassey.com' ||
      url.pathname !== '/cart' ||
      url.username ||
      url.password ||
      !/^ch1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(fragment.get('handoff') ?? '') ||
      !UUID.test(fragment.get('hid') ?? '')
    )
      return null;
    const clean = new URL('https://ogabassey.com/cart');
    clean.hash = new URLSearchParams({
      handoff: fragment.get('handoff') ?? '',
      hid: fragment.get('hid') ?? '',
    }).toString();
    return clean.toString();
  } catch {
    return null;
  }
}
/** Public cart ID correlates UI replies; it is never used as authority. */
export function parseConnectedCartReply(value: unknown): ConnectedCartReply | null {
  if (
    !value ||
    typeof value !== 'object' ||
    !('connection_bound' in value) ||
    value.connection_bound !== true
  )
    return null;
  const v = value as Record<string, unknown>;
  if (
    v.success !== true ||
    typeof v.canonical_cart_id !== 'string' ||
    !UUID.test(v.canonical_cart_id) ||
    typeof v.version !== 'number' ||
    !Number.isSafeInteger(v.version) ||
    v.version < 1 ||
    typeof v.cart_url !== 'string' ||
    !Array.isArray(v.items)
  )
    return null;
  const items = v.items.length === 0 ? [] : parseHandoffLines(JSON.stringify(v.items));
  if (!items) return null;
  const url = connectedCartReviewUrl(v.cart_url);
  if (!url && !(items.length === 0 && v.cart_url === 'https://ogabassey.com/cart')) return null;
  return { cartId: v.canonical_cart_id, version: v.version, url: url ?? v.cart_url, items };
}
export function mergeConnectedCartReply(
  previous: WidgetState | null | undefined,
  reply: ConnectedCartReply,
  added?: Product,
): WidgetState {
  const known = new Map((previous?.cart ?? []).map((item) => [item.product.id, item.product]));
  if (added) known.set(added.id, added);
  return {
    ...previous,
    cart: reply.items.flatMap((line) => {
      const product = known.get(line.product_id);
      return product ? [{ product, quantity: line.quantity }] : [];
    }),
    cartUrl: reply.url,
    cartToken: undefined,
    connectionCartId: reply.cartId,
    cartVersion: reply.version,
  };
}
