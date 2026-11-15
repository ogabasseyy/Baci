import { SHARED_CART_MAX_QUANTITY_PER_LINE } from '@baci/shared/cart';
import type { SharedCartDisplayItem } from './cart-types';

/**
 * Same-browser tabs tell each other about an edit the moment it is made, so
 * a second tab does not wait for the save and its own refetch to redraw.
 * The message is a display hint only: it carries line ids and quantities,
 * never adds a line, and the authorized server snapshot still decides.
 */
export interface CartPeerLine {
  id: string;
  quantity: number;
}

export type CartPeerMessage =
  | {
      kind: 'edit';
      merchantId: string;
      cartId: string;
      /** The sender's confirmed cart version the edit was made on. */
      version: number;
      lines: CartPeerLine[];
    }
  | {
      kind: 'settled';
      merchantId: string;
      cartId: string;
      /** The sender's confirmed version once nothing is pending. */
      version: number;
    };

export interface CartPeerChannel {
  post: (message: CartPeerMessage) => void;
  close: () => void;
}

export type OpenCartPeerChannel = (
  merchantId: string,
  onMessage: (value: unknown) => void
) => CartPeerChannel | null;

const MAX_ID_LENGTH = 128;
const MAX_LINES = 200;

function isId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH
  );
}

function readLines(value: unknown): CartPeerLine[] | null {
  if (!Array.isArray(value) || value.length > MAX_LINES) return null;
  const lines: CartPeerLine[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) return null;
    const { id, quantity } = entry as Record<string, unknown>;
    if (
      !isId(id) ||
      typeof quantity !== 'number' ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > SHARED_CART_MAX_QUANTITY_PER_LINE
    )
      return null;
    lines.push({ id, quantity });
  }
  return lines;
}

/** Anything not exactly a known message is dropped. */
export function readCartPeerMessage(value: unknown): CartPeerMessage | null {
  if (typeof value !== 'object' || value === null) return null;
  const { kind, merchantId, cartId, version, lines } = value as Record<
    string,
    unknown
  >;
  if (
    !isId(merchantId) ||
    !isId(cartId) ||
    typeof version !== 'number' ||
    !Number.isSafeInteger(version) ||
    version < 0
  )
    return null;
  if (kind === 'settled')
    return lines === undefined ? { cartId, kind, merchantId, version } : null;
  if (kind !== 'edit') return null;
  const parsed = readLines(lines);
  return parsed ? { cartId, kind, lines: parsed, merchantId, version } : null;
}

/** Only lines the server has confirmed: an unsaved add has no shared id. */
export function buildCartPeerLines(
  display: SharedCartDisplayItem[]
): CartPeerLine[] {
  const lines: CartPeerLine[] = [];
  for (const line of display) {
    if (line.serverLineId && line.pendingTempId == null)
      lines.push({ id: line.serverLineId, quantity: line.quantity });
  }
  return lines;
}

/**
 * Applies another tab's quantities and removals to lines this tab already
 * holds. Device-only and unsaved lines are left alone.
 */
export function applyCartPeerPreview(
  display: SharedCartDisplayItem[],
  lines: CartPeerLine[]
): SharedCartDisplayItem[] {
  const quantities = new Map(lines.map((line) => [line.id, line.quantity]));
  return display.flatMap((line) => {
    if (!line.serverLineId || line.pendingTempId != null) return [line];
    const quantity = quantities.get(line.serverLineId);
    if (quantity === undefined) return [];
    return quantity === line.quantity ? [line] : [{ ...line, quantity }];
  });
}

/** Browsers without BroadcastChannel keep the server-driven update. */
export const openCartPeerChannel: OpenCartPeerChannel = (
  merchantId,
  onMessage
) => {
  if (
    typeof window === 'undefined' ||
    typeof window.BroadcastChannel !== 'function'
  )
    return null;
  try {
    const channel = new window.BroadcastChannel(`baci-cart-peer:${merchantId}`);
    channel.onmessage = (event: MessageEvent<unknown>) => {
      onMessage(event.data);
    };
    return {
      close: () => {
        channel.onmessage = null;
        channel.close();
      },
      post: (message) => {
        try {
          channel.postMessage(message);
        } catch {
          /* The server-driven update still arrives. */
        }
      },
    };
  } catch {
    return null;
  }
};
