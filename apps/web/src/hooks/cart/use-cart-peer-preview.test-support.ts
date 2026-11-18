import type { CartSnapshot } from '@baci/shared/cart';
import type { OpenCartPeerChannel } from './cart-peer-preview';
import type { SharedCartDisplayItem } from './cart-types';
import {
  initialSharedCartState,
  type SharedCartPendingEntry,
  type SharedCartState,
} from './shared-cart-state';
import type { CartPeerPreviewContext } from './use-cart-peer-preview';

export function line(
  serverLineId: string,
  quantity: number
): SharedCartDisplayItem {
  return {
    cartItemId: serverLineId,
    id: `product-${serverLineId}`,
    name: 'Phone',
    pendingTempId: null,
    price: 100,
    quantity,
    serverLineId,
  } as SharedCartDisplayItem;
}

export function snapshot(version: number): CartSnapshot {
  const confirmedLines = [
    { id: 'l1', quantity: 1 },
    { id: 'l2', quantity: 1 },
  ];
  return {
    cartId: 'c',
    currency: 'NGN',
    estimatedTotals: false,
    expiresAt: '2099-01-01',
    lines: confirmedLines,
    merchantId: 'm',
    state: 'active',
    subtotalMinor: 0,
    totalMinor: 0,
    version,
  } as CartSnapshot;
}

export const edit: SharedCartPendingEntry = {
  attempts: 0,
  intent: {
    kind: 'set_quantity',
    quantity: 3,
    target: { kind: 'lineId', lineId: 'l1' },
  },
  operationId: 'op-1',
  state: 'queued',
};

export function context(
  state: Partial<SharedCartState> = {},
  version = 2
): CartPeerPreviewContext {
  return {
    enabled: true,
    merchantId: 'm',
    sessionGeneration: 1,
    state: {
      ...initialSharedCartState,
      cartId: 'c',
      confirmed: snapshot(version),
      display: [line('l1', 1), line('l2', 1)],
      generation: 1,
      importStatus: 'done',
      merchantId: 'm',
      ...state,
    },
  };
}

/** Same-browser tabs: a post reaches every other open channel. */
export function tabs() {
  const listeners = new Set<(value: unknown) => void>();
  const posted: unknown[] = [];
  const open: OpenCartPeerChannel = (_scope, onMessage) => {
    listeners.add(onMessage);
    return {
      close: () => {
        listeners.delete(onMessage);
      },
      post: (message) => {
        posted.push(message);
        for (const listener of listeners)
          if (listener !== onMessage) listener(message);
      },
    };
  };
  return {
    deliver: (value: unknown) => {
      for (const listener of listeners) listener(value);
    },
    open,
    posted,
  };
}

export const peerEdit = {
  sender: 'tab-a',
  cartId: 'c',
  kind: 'edit',
  lines: [{ id: 'l1', quantity: 3 }],
  merchantId: 'm',
  version: 2,
};

export const settledBy = {
  cartId: 'c',
  kind: 'settled',
  merchantId: 'm',
  sender: 'tab-a',
};
