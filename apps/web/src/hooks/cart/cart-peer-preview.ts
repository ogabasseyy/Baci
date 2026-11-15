import {
  SHARED_CART_MAX_LINES,
  SHARED_CART_MAX_QUANTITY_PER_LINE,
} from '@baci/shared/cart';
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
      /** Random per-tab id, so a settle only ends that tab's preview. */
      sender: string;
      merchantId: string;
      cartId: string;
      /** The sender's confirmed cart version the edit was made on. */
      version: number;
      lines: CartPeerLine[];
    }
  | {
      kind: 'settled';
      sender: string;
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
  scope: { merchantId: string; cartId: string },
  onMessage: (value: unknown) => void
) => CartPeerChannel | null;

const MAX_ID_LENGTH = 128;
/** A cart cannot hold more lines than the server allows. */
const MAX_LINES = SHARED_CART_MAX_LINES;

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
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) return null;
    const { id, quantity } = entry as Record<string, unknown>;
    if (
      !isId(id) ||
      seen.has(id) ||
      typeof quantity !== 'number' ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > SHARED_CART_MAX_QUANTITY_PER_LINE
    )
      return null;
    seen.add(id);
    lines.push({ id, quantity });
  }
  return lines;
}

/**
 * Drops unknown kinds, malformed fields, and a settled message that carries
 * lines. Other extra fields are ignored. Cart versions start at 1.
 */
export function readCartPeerMessage(value: unknown): CartPeerMessage | null {
  if (typeof value !== 'object' || value === null) return null;
  const { kind, sender, merchantId, cartId, version, lines } = value as Record<
    string,
    unknown
  >;
  if (
    !isId(sender) ||
    !isId(merchantId) ||
    !isId(cartId) ||
    typeof version !== 'number' ||
    !Number.isSafeInteger(version) ||
    version < 1
  )
    return null;
  if (kind === 'settled')
    return lines === undefined
      ? { cartId, kind, merchantId, sender, version }
      : null;
  if (kind !== 'edit') return null;
  const parsed = readLines(lines);
  return parsed
    ? { cartId, kind, lines: parsed, merchantId, sender, version }
    : null;
}

/**
 * Every line the server already knows. That includes a line with an unsaved
 * add merged into it (it keeps its server id): leaving it out would read as
 * a removal. A brand-new unsaved line has no shared id and is not sent.
 */
export function buildCartPeerLines(
  display: SharedCartDisplayItem[]
): CartPeerLine[] {
  const lines: CartPeerLine[] = [];
  for (const line of display) {
    if (line.serverLineId)
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

/**
 * A per-tab label for routing settle messages, not a secret. randomUUID is
 * missing on plain-HTTP origins and older browsers, and this runs during
 * render, so it must never throw.
 */
export function createCartPeerSender(): string {
  try {
    if (
      typeof crypto !== 'undefined' &&
      typeof crypto.randomUUID === 'function'
    )
      return crypto.randomUUID();
  } catch {
    /* Fall through to the non-cryptographic label. */
  }
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Browsers without BroadcastChannel keep the server-driven update. */
export const openCartPeerChannel: OpenCartPeerChannel = (scope, onMessage) => {
  if (
    typeof window === 'undefined' ||
    typeof window.BroadcastChannel !== 'function'
  )
    return null;
  try {
    const channel = new window.BroadcastChannel(
      // One channel per cart: tabs on another cart are never woken.
      `baci-cart-peer:${scope.merchantId}:${scope.cartId}`
    );
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
